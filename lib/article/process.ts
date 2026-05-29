import { db } from "@/lib/db";
import { article } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { fetchArticleHtml } from "./fetch";
import {
  extractArticleContent,
  smartChunkContent,
  getSiteConfig,
} from "./extract";
import { translateChunk, detectLanguage } from "./translate";
import type { TranslationBlock } from "./types";

export async function processTranslation(
  articleId: string,
  sourceUrl: string,
  targetLanguage: string,
  cefrLevel: string,
) {
  let paragraphs: string[] = [];
  const translatedBlocks: TranslationBlock[] = [];
  let title = "Untitled";

  const siteConfig = getSiteConfig(sourceUrl);

  try {
    // Phase 1: Fetch content
    console.log(`[${articleId}] Fetching article from ${sourceUrl}`);

    const fetchResult = await fetchArticleHtml(sourceUrl, articleId);

    if (!fetchResult) {
      await db
        .update(article)
        .set({
          status: "failed",
          errorMessage: "Failed to fetch article content",
        })
        .where(eq(article.id, articleId));
      return;
    }

    let contentForTranslation: string;

    if (siteConfig?.skipReadability) {
      contentForTranslation = fetchResult.html;
      const titleMatch = fetchResult.html.match(
        /<title[^>]*>([^<]+)<\/title>/i,
      );
      title = titleMatch
        ? titleMatch[1].replace(/\s*[-|].*$/, "").trim()
        : "Untitled";
    } else {
      const extracted = extractArticleContent(fetchResult.html, sourceUrl);

      if (!extracted || !extracted.content || extracted.content.length < 100) {
        await db
          .update(article)
          .set({
            status: "failed",
            errorMessage: "Article content too short or couldn't be extracted",
          })
          .where(eq(article.id, articleId));
        return;
      }

      title = extracted.title;
      contentForTranslation = extracted.content;
    }

    if (siteConfig?.noChunk) {
      paragraphs = [contentForTranslation];
    } else {
      paragraphs = smartChunkContent(contentForTranslation);
    }

    // Detect source language
    const textSample = siteConfig?.skipReadability
      ? contentForTranslation.replace(/<[^>]+>/g, " ").slice(0, 1000)
      : contentForTranslation.slice(0, 1000);
    const sourceLanguage = await detectLanguage(textSample);

    await db
      .update(article)
      .set({
        title,
        originalContent: JSON.stringify(paragraphs),
        sourceLanguage,
        status: "translating",
        totalParagraphs: paragraphs.length,
        translationProgress: 0,
      })
      .where(eq(article.id, articleId));

    console.log(`[${articleId}] Extracted ${paragraphs.length} paragraphs`);

    // Phase 2: Translate in parallel
    const MAX_PARALLEL = 15;
    const translateOptions = siteConfig?.returnCleanOriginal
      ? { returnCleanOriginal: true }
      : undefined;

    let failedChunks = 0;

    for (let i = 0; i < paragraphs.length; i += MAX_PARALLEL) {
      const wave = paragraphs.slice(i, i + MAX_PARALLEL);

      console.log(
        `[${articleId}] Translating chunks ${i + 1}-${Math.min(i + MAX_PARALLEL, paragraphs.length)} of ${paragraphs.length}`,
      );

      const results = await Promise.allSettled(
        wave.map((chunk) =>
          translateChunk(chunk, targetLanguage, cefrLevel, translateOptions),
        ),
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const originalChunk = wave[j];

        if (result.status === "fulfilled") {
          translatedBlocks.push(result.value);
        } else {
          console.error(
            `[${articleId}] Chunk ${i + j + 1} failed:`,
            result.reason,
          );
          failedChunks++;
          // Push a placeholder marked as failed so the UI can render it
          // distinctly and the user knows what went wrong.
          translatedBlocks.push({
            original: originalChunk,
            translated: "",
          });
        }
      }

      // Save progress after each wave
      const progress = Math.min(translatedBlocks.length, paragraphs.length);
      await db
        .update(article)
        .set({
          translatedContent: JSON.stringify(translatedBlocks),
          translationProgress: progress,
        })
        .where(eq(article.id, articleId));

      console.log(
        `[${articleId}] Progress: ${progress}/${paragraphs.length} (failed: ${failedChunks})`,
      );
    }

    // If more than half the chunks failed, treat the whole article as
    // failed so the user retries rather than reading a half-empty page.
    const failureRate =
      paragraphs.length > 0 ? failedChunks / paragraphs.length : 0;
    if (failureRate > 0.5) {
      await db
        .update(article)
        .set({
          translatedContent: JSON.stringify(translatedBlocks),
          status: "failed",
          errorMessage: `Translation failed for ${failedChunks}/${paragraphs.length} paragraphs. The LLM may not support structured output well — try a different model.`,
          translationProgress: translatedBlocks.length,
        })
        .where(eq(article.id, articleId));
      console.log(`[${articleId}] Marked failed (${failedChunks}/${paragraphs.length} chunks failed)`);
      return;
    }

    // Calculate word count and mark as completed
    const wordCount = translatedBlocks.reduce(
      (acc, block) => acc + (block.translated?.split(/\s+/).length || 0),
      0,
    );

    await db
      .update(article)
      .set({
        translatedContent: JSON.stringify(translatedBlocks),
        // Use "completed" even for partial successes so the UI shows the
        // article; surface partial failures via errorMessage.
        status: "completed",
        wordCount,
        errorMessage:
          failedChunks > 0
            ? `${failedChunks}/${paragraphs.length} paragraphs failed to translate.`
            : null,
        translationProgress: paragraphs.length,
      })
      .where(eq(article.id, articleId));

    console.log(`[${articleId}] Translation done. ${wordCount} words, ${failedChunks} failures`);
  } catch (error) {
    console.error(`[${articleId}] Translation error:`, error);

    await db
      .update(article)
      .set({
        translatedContent:
          translatedBlocks.length > 0
            ? JSON.stringify(translatedBlocks)
            : null,
        translationProgress: translatedBlocks.length,
        status: "failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Translation failed. You can retry to continue.",
      })
      .where(eq(article.id, articleId));
  }
}
