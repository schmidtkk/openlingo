import { tool } from "ai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  userMemory,
  unit,
  userStats,
  userPreferences,
  dictionaryWord,
  srsCard,
  article,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { parseExercise } from "@/lib/content/parser";
import { langCodeToName } from "@/lib/prompts";
import { supportedLanguages } from "@/lib/languages";
import { parseUnitMarkdown } from "@/lib/content/loader";

export function createTools(userId: string, language?: string) {
  return {
    readMemory: tool({
      description:
        "Read everything stored in the user's memory. Returns free-text notes that accumulate over time.",
      inputSchema: z.object({}),
      execute: async () => {
        const [row] = await db
          .select()
          .from(userMemory)
          .where(
            and(eq(userMemory.userId, userId), eq(userMemory.key, "memory")),
          )
          .limit(1);
        return row
          ? { found: true, value: row.value }
          : { found: false, value: "" };
      },
    }),

    addMemory: tool({
      description:
        "Append a line to the user's memory. The text is added after a line break at the end of existing memory.",
      inputSchema: z.object({
        text: z.string().describe("The text to append to memory"),
      }),
      execute: async ({ text }) => {
        const [existing] = await db
          .select()
          .from(userMemory)
          .where(
            and(eq(userMemory.userId, userId), eq(userMemory.key, "memory")),
          )
          .limit(1);

        const newValue = existing ? existing.value + "\n" + text : text;

        await db
          .insert(userMemory)
          .values({ userId, key: "memory", value: newValue })
          .onConflictDoUpdate({
            target: [userMemory.userId, userMemory.key],
            set: { value: newValue, updatedAt: new Date() },
          });
        return { success: true };
      },
    }),

    rewriteAllMemory: tool({
      description:
        "Replace the user's entire memory with new content. Use when memory needs to be reorganized or cleaned up.",
      inputSchema: z.object({
        value: z
          .string()
          .describe("The new content to replace all existing memory"),
      }),
      execute: async ({ value }) => {
        await db
          .insert(userMemory)
          .values({ userId, key: "memory", value })
          .onConflictDoUpdate({
            target: [userMemory.userId, userMemory.key],
            set: { value, updatedAt: new Date() },
          });
        return { success: true };
      },
    }),

    getSrsStats: tool({
      description:
        "Return counts of the user's SRS cards: total, due now, new (not yet studied), and learning vs review status. Optionally filter by language.",
      inputSchema: z.object({
        language: z
          .string()
          .optional()
          .describe("Optional language code filter (e.g. 'de', 'fr')."),
      }),
      execute: async ({ language: lang }) => {
        const conds = [eq(srsCard.userId, userId)];
        if (lang) conds.push(eq(srsCard.language, lang));
        const baseWhere = and(...conds);
        const now = new Date();

        const [total] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(srsCard)
          .where(baseWhere);
        const [due] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(srsCard)
          .where(and(baseWhere, lte(srsCard.nextReviewAt, now)));
        const [newCount] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(srsCard)
          .where(and(baseWhere, eq(srsCard.status, "new")));
        const [learning] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(srsCard)
          .where(and(baseWhere, eq(srsCard.status, "learning")));
        const [review] = await db
          .select({ c: sql<number>`count(*)::int` })
          .from(srsCard)
          .where(and(baseWhere, eq(srsCard.status, "review")));

        return {
          language: lang ?? "all",
          total: total?.c ?? 0,
          dueNow: due?.c ?? 0,
          new: newCount?.c ?? 0,
          learning: learning?.c ?? 0,
          review: review?.c ?? 0,
        };
      },
    }),

    getDueCards: tool({
      description:
        "Return up to `limit` SRS cards that are due for review (nextReviewAt <= now). Optionally filter by language. Use this before presenting a review exercise.",
      inputSchema: z.object({
        language: z.string().optional().describe("Optional language code filter."),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ language: lang, limit }) => {
        const conds = [
          eq(srsCard.userId, userId),
          lte(srsCard.nextReviewAt, new Date()),
        ];
        if (lang) conds.push(eq(srsCard.language, lang));
        const rows = await db
          .select({
            word: srsCard.word,
            translation: srsCard.translation,
            language: srsCard.language,
            status: srsCard.status,
            exampleNative: srsCard.exampleNative,
            exampleEnglish: srsCard.exampleEnglish,
            nextReviewAt: srsCard.nextReviewAt,
          })
          .from(srsCard)
          .where(and(...conds))
          .orderBy(asc(srsCard.nextReviewAt))
          .limit(limit);
        return { count: rows.length, cards: rows };
      },
    }),

    getNewCards: tool({
      description:
        "Return up to `limit` SRS cards that the user has not yet started studying (status='new'). Use before introducing fresh vocabulary.",
      inputSchema: z.object({
        language: z.string().describe("Language code (required)."),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ language: lang, limit }) => {
        const rows = await db
          .select({
            word: srsCard.word,
            translation: srsCard.translation,
            cefrLevel: srsCard.cefrLevel,
            pos: srsCard.pos,
            gender: srsCard.gender,
            exampleNative: srsCard.exampleNative,
            exampleEnglish: srsCard.exampleEnglish,
          })
          .from(srsCard)
          .where(
            and(
              eq(srsCard.userId, userId),
              eq(srsCard.language, lang),
              eq(srsCard.status, "new"),
            ),
          )
          .orderBy(desc(srsCard.createdAt))
          .limit(limit);
        return { count: rows.length, cards: rows };
      },
    }),

    reviewCard: tool({
      description:
        "Record a review of one SRS card. quality: 0=Again (forgot), 3=Hard, 4=Good, 5=Easy. Updates the card's schedule via SM-2. Only this user's card is affected.",
      inputSchema: z.object({
        word: z.string(),
        language: z.string(),
        quality: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
        ]),
      }),
      execute: async ({ word, language: lang, quality }) => {
        try {
          // reviewCardAction uses requireSession; we bypass by inlining the
          // same scheduling logic and binding userId.
          const { calculateNextReview } = await import("@/lib/srs");
          const normalizedWord = word.toLowerCase();
          const [card] = await db
            .select()
            .from(srsCard)
            .where(
              and(
                eq(srsCard.word, normalizedWord),
                eq(srsCard.language, lang),
                eq(srsCard.userId, userId),
              ),
            );
          if (!card) return { success: false, error: "Card not found" };

          const result = calculateNextReview(
            {
              easeFactor: card.easeFactor,
              interval: card.interval,
              repetitions: card.repetitions,
              status: (card.status as "new" | "learning" | "review") ?? "learning",
            },
            quality,
          );

          await db
            .update(srsCard)
            .set({
              easeFactor: result.easeFactor,
              interval: result.interval,
              repetitions: result.repetitions,
              status: result.status,
              nextReviewAt: result.nextReviewAt,
              lastReviewedAt: new Date(),
            })
            .where(
              and(
                eq(srsCard.word, normalizedWord),
                eq(srsCard.language, lang),
                eq(srsCard.userId, userId),
              ),
            );

          return { success: true, status: result.status, nextReviewAt: result.nextReviewAt };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      },
    }),

    presentExercise: tool({
      description:
        "Present an interactive exercise to the user. Pass the exercise as a markdown block (starting with the [type] tag) using the exercise syntax from the system prompt. The tool parses and renders it as an interactive widget. Present ONE exercise at a time and wait for the user to complete it before presenting another.",
      inputSchema: z.object({
        markdown: z
          .string()
          .describe(
            'Exercise markdown block starting with [type-tag], e.g. \'[multiple-choice]\\ntext: "What does gato mean?"\\n- "Cat" (correct)\\n- "Dog"\'',
          ),
      }),
      execute: async ({ markdown }) => {
        try {
          const exercise = parseExercise(markdown);
          return { success: true, exercise };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      },
    }),

    createUnit: tool({
      description:
        "Create a learning unit from exercise markdown. The markdown MUST include ALL metadata in YAML frontmatter: title, description, icon, color, targetLanguage, sourceLanguage, and level. Then ## Lesson sections with exercises. This tool parses, validates, and inserts into the DB.",
      inputSchema: z.object({
        markdown: z
          .string()
          .describe(
            "Complete unit markdown with YAML frontmatter (title, description, icon, color, targetLanguage, sourceLanguage, level) and ## Lesson sections containing exercises",
          ),
        courseId: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Optional course UUID to assign this unit to. Overrides courseId from frontmatter if provided.",
          ),
      }),
      execute: async ({ markdown, courseId: courseIdParam }) => {
        // Read fresh from DB — the user may have switched languages mid-conversation
        const [prefRow] = await db
          .select({ targetLanguage: userPreferences.targetLanguage })
          .from(userPreferences)
          .where(eq(userPreferences.userId, userId))
          .limit(1);
        const fallbackLang = prefRow?.targetLanguage ?? language ?? "de";

        const cleaned = markdown
          .replace(/^```(?:markdown|md)?\n/m, "")
          .replace(/\n```\s*$/, "")
          .trim();

        let parsedUnit;
        const unitId = crypto.randomUUID();
        try {
          parsedUnit = parseUnitMarkdown(cleaned);
        } catch (err) {
          return {
            success: false,
            error: `Failed to parse markdown: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        // targetLanguage is required — fall back to user preference if missing from frontmatter
        const targetLanguage = parsedUnit.targetLanguage ?? fallbackLang;

        // Tool param overrides frontmatter courseId
        const courseId = courseIdParam ?? parsedUnit.courseId;

        await db.insert(unit).values({
          id: unitId,
          courseId,
          title: parsedUnit.title,
          description: parsedUnit.description,
          icon: parsedUnit.icon,
          color: parsedUnit.color,
          markdown: cleaned,
          targetLanguage,
          sourceLanguage: parsedUnit.sourceLanguage,
          level: parsedUnit.level,
          createdBy: userId,
        });

        await db.insert(userStats).values({ userId }).onConflictDoNothing();

        const exerciseCount = parsedUnit.lessons.reduce(
          (sum, l) => sum + l.exercises.length,
          0,
        );

        revalidatePath("/units", "page");

        return {
          success: true,
          courseId: courseId ?? undefined,
          unitId,
          title: parsedUnit.title,
          description: parsedUnit.description,
          icon: parsedUnit.icon,
          color: parsedUnit.color,
          level: parsedUnit.level,
          lessonCount: parsedUnit.lessons.length,
          exerciseCount,
          lessonTitles: parsedUnit.lessons.map((l) => l.title),
          url: `/unit/${unitId}`,
        };
      },
    }),

    addWordsToSrs: tool({
      description:
        "Bulk-add words from the dictionary to the user's SRS deck. Filters by language (required), and optionally by CEFR level and/or word frequency range. Only adds words marked as useful for flashcards that aren't already in the user's deck.",
      inputSchema: z.object({
        language: z.string().describe("Language code, e.g. 'de', 'fr', 'es'"),
        cefrLevel: z
          .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
          .optional()
          .describe("Filter by CEFR level (exact match)"),
        minFrequency: z
          .number()
          .int()
          .optional()
          .describe("Minimum word frequency (inclusive)"),
        maxFrequency: z
          .number()
          .int()
          .optional()
          .describe("Maximum word frequency (inclusive)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(5000)
          .default(500)
          .describe("Max words to add (default 500, max 5000)"),
      }),
      execute: async ({
        language: lang,
        cefrLevel,
        minFrequency,
        maxFrequency,
        limit: maxWords,
      }) => {
        const conditions = [
          eq(dictionaryWord.language, lang),
          eq(dictionaryWord.usefulForFlashcard, true),
        ];

        if (cefrLevel) {
          conditions.push(eq(dictionaryWord.cefrLevel, cefrLevel));
        }
        if (minFrequency !== undefined) {
          conditions.push(gte(dictionaryWord.wordFrequency, minFrequency));
        }
        if (maxFrequency !== undefined) {
          conditions.push(lte(dictionaryWord.wordFrequency, maxFrequency));
        }

        const words = await db
          .select({
            word: dictionaryWord.word,
            translation: dictionaryWord.englishTranslation,
            cefrLevel: dictionaryWord.cefrLevel,
            pos: dictionaryWord.pos,
            gender: dictionaryWord.gender,
            exampleNative: dictionaryWord.exampleSentenceNative,
            exampleEnglish: dictionaryWord.exampleSentenceEnglish,
          })
          .from(dictionaryWord)
          .where(and(...conditions))
          .orderBy(dictionaryWord.wordFrequency)
          .limit(maxWords);

        if (words.length === 0) {
          return {
            success: true,
            added: 0,
            message: "No matching words found in dictionary.",
          };
        }

        const BATCH_SIZE = 500;
        for (let i = 0; i < words.length; i += BATCH_SIZE) {
          const batch = words.slice(i, i + BATCH_SIZE);
          await db
            .insert(srsCard)
            .values(
              batch.map((w) => ({
                word: w.word.toLowerCase(),
                language: lang,
                userId,
                translation: w.translation,
                cefrLevel: w.cefrLevel,
                pos: w.pos,
                gender: w.gender,
                exampleNative: w.exampleNative,
                exampleEnglish: w.exampleEnglish,
                status: "new" as const,
                nextReviewAt: null,
              })),
            )
            .onConflictDoNothing();
        }

        return {
          success: true,
          totalMatched: words.length,
          message: `Matched ${words.length} words from dictionary and added to SRS (duplicates skipped).`,
        };
      },
    }),

    switchLanguage: tool({
      description:
        "Switch the user's target language and/or native language. At least one must be provided.",
      inputSchema: z.object({
        target_language: z
          .string()
          .optional()
          .describe(
            "Target language code (e.g. 'fr', 'es', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'ko', 'zh', 'ja')",
          ),
        native_language: z
          .string()
          .optional()
          .describe(
            "Native language code (e.g. 'en', 'fr', 'es', 'de')",
          ),
      }),
      execute: async ({ target_language, native_language }) => {
        if (!target_language && !native_language) {
          return { success: false, error: "Provide at least one of target_language or native_language." };
        }

        const allSupported = Object.keys(supportedLanguages);
        const supportedList = allSupported
          .map((k) => `${k} (${langCodeToName[k] || k})`)
          .join(", ");

        if (target_language && !supportedLanguages[target_language]) {
          return {
            success: false,
            error: `Unsupported target language "${target_language}". Supported: ${supportedList}`,
          };
        }

        if (native_language && !supportedLanguages[native_language]) {
          return {
            success: false,
            error: `Unsupported native language "${native_language}". Supported: ${supportedList}`,
          };
        }

        const changes: string[] = [];

        if (target_language) {
          await db
            .insert(userPreferences)
            .values({ userId, targetLanguage: target_language })
            .onConflictDoUpdate({
              target: userPreferences.userId,
              set: { targetLanguage: target_language, updatedAt: new Date() },
            });
          changes.push(`target language to ${langCodeToName[target_language] || target_language}`);
        }

        if (native_language) {
          await db
            .insert(userPreferences)
            .values({ userId, nativeLanguage: native_language, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: userPreferences.userId,
              set: { nativeLanguage: native_language, updatedAt: new Date() },
            });
          changes.push(`native language to ${langCodeToName[native_language] || native_language}`);
        }

        revalidatePath("/");

        return {
          success: true,
          target_language: target_language ?? undefined,
          native_language: native_language ?? undefined,
          message: `Switched ${changes.join(" and ")}.`,
        };
      },
    }),

    webSearch: tool({
      description:
        "Search the web using Exa to find articles, news, or information. Useful for finding content to translate with readArticle, or for looking up current information. Returns titles, URLs, summaries, and highlights for each result.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "The search query. Be specific and descriptive for best results.",
          ),
        numResults: z
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Number of results to return (default 5, max 10)"),
        category: z
          .enum([
            "news",
            "research paper",
            "company",
            "tweet",
            "personal site",
          ])
          .optional()
          .describe(
            "Optional category to focus the search (e.g. 'news' for recent articles)",
          ),
        startPublishedDate: z
          .string()
          .optional()
          .describe(
            "Only return results published after this date. ISO 8601 format, e.g. '2025-01-01T00:00:00.000Z'",
          ),
      }),
      execute: async ({ query, numResults, category, startPublishedDate }) => {
        const apiKey = process.env.EXA_API_KEY;
        if (!apiKey) {
          return {
            success: false,
            error:
              "Exa API key is not configured. Web search is not available.",
          };
        }

        try {
          const body: Record<string, unknown> = {
            query,
            numResults,
            type: "auto",
            contents: {
              highlights: {
                maxCharacters: 3000,
              },
              summary: {
                query,
              },
            },
          };

          if (category) body.category = category;
          if (startPublishedDate) body.startPublishedDate = startPublishedDate;

          const response = await fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });

          if (!response.ok) {
            const errorText = await response.text();
            return {
              success: false,
              error: `Exa API error (${response.status}): ${errorText}`,
            };
          }

          const data = await response.json();
          const results = (
            data.results as Array<{
              title?: string;
              url?: string;
              publishedDate?: string;
              author?: string;
              summary?: string;
              highlights?: string[];
            }>
          ).map((r) => ({
            title: r.title || "Untitled",
            url: r.url || "",
            publishedDate: r.publishedDate || null,
            author: r.author || null,
            summary: r.summary || null,
            highlights: r.highlights || [],
          }));

          return {
            success: true,
            query,
            resultCount: results.length,
            results,
          };
        } catch (e) {
          return {
            success: false,
            error: `Web search failed: ${(e as Error).message}`,
          };
        }
      },
    }),

    readArticle: tool({
      description:
        "Read a web article and translate it to a target language at a CEFR level. Creates a saved article the user can read later. Returns immediately with article ID — translation happens in background.",
      inputSchema: z.object({
        url: z.string().url().describe("The URL of the article to translate"),
        cefrLevel: z
          .enum(["A1", "A2", "B1", "B2", "C1", "C2"])
          .default("B1")
          .describe("CEFR difficulty level for the translation"),
        targetLanguage: z
          .string()
          .optional()
          .describe(
            "Language code to translate into (e.g. 'de', 'fr', 'es'). Defaults to the user's current target language.",
          ),
      }),
      execute: async ({ url, cefrLevel, targetLanguage }) => {
        // Lazy-load article processing so /api/chat can boot without jsdom.
        const { processTranslation } = await import("@/lib/article/process");
        const lang = targetLanguage || language || "de";
        const langName = langCodeToName[lang] || lang;

        // Check for existing article with same URL + language + level
        const [existing] = await db
          .select()
          .from(article)
          .where(
            and(
              eq(article.userId, userId),
              eq(article.sourceUrl, url),
              eq(article.targetLanguage, langName),
              eq(article.cefrLevel, cefrLevel),
            ),
          )
          .limit(1);

        if (existing?.status === "completed") {
          return {
            success: true,
            articleId: existing.id,
            status: "completed",
            title: existing.title,
            url: `/read/${existing.id}`,
            message: "This article was already translated!",
          };
        }

        if (
          existing &&
          (existing.status === "fetching" || existing.status === "translating")
        ) {
          return {
            success: true,
            articleId: existing.id,
            status: existing.status,
            url: `/read/${existing.id}`,
            message: "This article is already being translated.",
          };
        }

        // Create new article record
        const articleId = crypto.randomUUID();
        await db.insert(article).values({
          id: articleId,
          userId,
          sourceUrl: url,
          targetLanguage: langName,
          cefrLevel,
          status: "fetching",
        });

        // Start background translation (fire-and-forget)
        processTranslation(articleId, url, langName, cefrLevel).catch(
          (error) => {
            console.error(
              `[${articleId}] Background processing error:`,
              error,
            );
          },
        );

        revalidatePath("/read", "page");

        return {
          success: true,
          articleId,
          status: "fetching",
          url: `/read/${articleId}`,
          message: `Started translating article to ${langName} at ${cefrLevel} level. The user can check progress at /read/${articleId}.`,
        };
      },
    }),
  };
}
