import { generateObject, generateText } from "ai";
import { z } from "zod";
import { getModel, getDefaultModel } from "@/lib/ai/models";
import { getCefrGuidelines } from "./cefr-guidelines";
import type { TranslationBlock } from "./types";

function model() {
  return getModel(getDefaultModel());
}

export async function detectLanguage(text: string): Promise<string> {
  const sample = text.slice(0, 500);
  const prompt = `Detect the language of the following text. Return ONLY the language name in English (e.g., "German", "French", "Spanish"). No explanation, just the language name.\n\nText:\n${sample}`;

  try {
    const { text: out } = await generateText({ model: model(), prompt });
    const detected = out?.trim();
    if (detected) {
      const normalized = detected.replace(/[^a-zA-Z]/g, "");
      return (
        normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase()
      );
    }
  } catch (error) {
    console.error("[article.detectLanguage] failed:", error);
  }

  return "Unknown";
}

const translationSchema = z.object({
  original: z.string(),
  translated: z.string(),
  bridge: z.string().optional(),
});

export async function translateChunk(
  text: string,
  targetLanguage: string,
  cefrLevel: string,
  options?: { returnCleanOriginal?: boolean },
): Promise<TranslationBlock> {
  const levelGuidelines = getCefrGuidelines(targetLanguage, cefrLevel);
  const returnCleanOriginal = options?.returnCleanOriginal ?? false;

  const outputInstructions = returnCleanOriginal
    ? `Return JSON:
{
  "original": "the CLEAN extracted article text in the SOURCE language (no HTML, no garbage)",
  "translated": "the complete adapted ${targetLanguage} text at ${cefrLevel} level",
  "bridge": "English translation that maps EXACTLY 1-1 to your translated text"
}

IMPORTANT:
- The "original" field must contain the clean, readable source article text.
- The "bridge" field must have the SAME NUMBER OF SENTENCES as "translated", in the same order.`
    : `Return JSON:
{
  "original": "the source text you received (preserve it exactly)",
  "translated": "the complete adapted ${targetLanguage} text at ${cefrLevel} level",
  "bridge": "English translation that maps EXACTLY 1-1 to your translated text"
}

IMPORTANT:
- The "original" field must contain the input text you received - preserve it, do NOT summarize.
- The "bridge" field must have the SAME NUMBER OF SENTENCES as "translated", in the same order.`;

  const prompt = `You are a professional language learning content adapter. Your job is to extract article content and translate/adapt it into ${targetLanguage} for a ${cefrLevel} learner.

${levelGuidelines}

---

## CONTENT EXTRACTION RULES

The input may be either:
- Raw HTML from a news website (extract the article text, ignore all HTML tags/markup)
- Plain text that's already been extracted

From either format, extract ONLY the main article content.

INCLUDE: News paragraphs, quotes, factual information, analysis
EXCLUDE: HTML tags, subscription prompts, navigation, cookie notices, ads, "Read also" links

If the input contains ONLY non-article content, return {"original": "", "translated": ""}.

---

## YOUR TASK

1. If input is HTML: extract the article text first
2. Identify ALL key points, quotes, and facts
3. Translate/adapt into ${targetLanguage} at ${cefrLevel} level
4. Apply ALL grammar and vocabulary constraints from the guidelines above
5. Capture all significant information - don't over-summarize

${outputInstructions}

---

INPUT:
${text}`;

  // Up to 2 attempts: providers occasionally return malformed JSON for
  // structured output on first try.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { object } = await generateObject({
        model: model(),
        schema: translationSchema,
        prompt,
      });

      if (object.translated && object.translated.trim().length > 0) {
        const originalText =
          returnCleanOriginal && object.original && object.original.length > 50
            ? object.original
            : text;
        return {
          original: originalText,
          translated: object.translated,
          bridge: object.bridge || undefined,
        };
      }
    } catch (error) {
      console.error(
        `[article.translateChunk] attempt ${attempt + 1} failed:`,
        error,
      );
    }
  }

  // Throw so the caller can count this as a real failure instead of
  // silently storing untranslated text as a "translation".
  throw new Error("Translation failed after retries");
}
