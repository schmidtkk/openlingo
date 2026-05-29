import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { requireSession } from "@/lib/auth-server";
import { db } from "@/lib/db";
import { article } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { uploadAudio, getPublicUrl } from "@/lib/r2";
import { generateAudioBuffer, getTTSClient, ttsProfileTag } from "@/lib/tts";

interface TranslationBlock {
  original: string;
  translated: string;
}

/** Per-block character limit; both OpenAI TTS and most local servers
 *  prefer payloads under ~4000 chars. */
const MAX_TTS_CHARS = 3500;

const useLocalStorage = !process.env.R2_ACCOUNT_ID;

async function storeArticleAudio(
  articleId: string,
  buffer: Buffer,
): Promise<{ key: string; publicUrl: string }> {
  const hash = createHash("md5").update(buffer).digest("hex").slice(0, 8);
  if (useLocalStorage) {
    const dir = path.join(process.cwd(), ".audio-cache", "article-audio");
    await fs.mkdir(dir, { recursive: true });
    const filename = `${articleId}-${hash}.mp3`;
    await fs.writeFile(path.join(dir, filename), buffer);
    return {
      key: `local/article-audio/${filename}`,
      publicUrl: getPublicUrl(`local/article-audio/${filename}`),
    };
  }
  const key = `article-audio/${articleId}-${hash}.mp3`;
  await uploadAudio(key, buffer);
  return { key, publicUrl: getPublicUrl(key) };
}

// GET — Get audio URL for existing audio
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await params;

  const [row] = await db
    .select({ audioUrl: article.audioUrl })
    .from(article)
    .where(and(eq(article.id, id), eq(article.userId, session.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }
  if (!row.audioUrl) {
    return NextResponse.json({ error: "No audio available" }, { status: 404 });
  }
  if (row.audioUrl === "generating") {
    return NextResponse.json({ status: "generating" });
  }

  return NextResponse.json({ audioUrl: getPublicUrl(row.audioUrl) });
}

/** Split a paragraph into <= MAX_TTS_CHARS pieces, splitting on sentence
 *  boundaries when possible. */
function splitForTts(text: string): string[] {
  if (text.length <= MAX_TTS_CHARS) return [text];
  const pieces: string[] = [];
  const sentences = text.split(/(?<=[.!?。！？])\s+/);
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > MAX_TTS_CHARS) {
      if (buf) pieces.push(buf);
      buf = s;
    } else {
      buf = buf ? buf + " " + s : s;
    }
  }
  if (buf) pieces.push(buf);
  // Hard-split any over-long single sentence.
  return pieces.flatMap((p) =>
    p.length <= MAX_TTS_CHARS
      ? [p]
      : Array.from({ length: Math.ceil(p.length / MAX_TTS_CHARS) }, (_, i) =>
          p.slice(i * MAX_TTS_CHARS, (i + 1) * MAX_TTS_CHARS),
        ),
  );
}

async function generateAudioInBackground(
  articleId: string,
  translatedContent: string,
  targetLanguage: string,
) {
  try {
    let blocks: TranslationBlock[];
    try {
      blocks = JSON.parse(translatedContent);
    } catch {
      console.error(`[Audio] Invalid article content for ${articleId}`);
      await db
        .update(article)
        .set({ audioUrl: null })
        .where(eq(article.id, articleId));
      return;
    }

    // Build full text and chunk it. Earlier code sliced to 4096 chars
    // and silently dropped the rest — long articles lost most audio.
    const fullText = blocks
      .map((b) => b.translated)
      .filter((t) => t && t.trim().length > 0)
      .join("\n\n");
    if (!fullText.trim()) {
      await db
        .update(article)
        .set({ audioUrl: null })
        .where(eq(article.id, articleId));
      return;
    }

    const chunks = splitForTts(fullText);
    console.log(
      `[Audio] ${articleId}: ${chunks.length} chunks via ${getTTSClient().model}`,
    );

    const instructions = `Speak in ${targetLanguage} with clear native pronunciation. Calm, measured pace for language learners.`;

    // Bounded concurrency: GPU TTS likes parallel, OpenAI rate-limits.
    const concurrency = process.env.LOCAL_TTS_URL ? 4 : 1;
    const buffers: Buffer[] = new Array(chunks.length);
    let cursor = 0;
    async function worker() {
      while (cursor < chunks.length) {
        const i = cursor++;
        buffers[i] = await generateAudioBuffer(chunks[i], instructions, targetLanguage);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, chunks.length) }, worker),
    );

    // MP3 frames can be concatenated as bytes (each frame is self-contained).
    const combined = Buffer.concat(buffers);
    const { key } = await storeArticleAudio(articleId, combined);

    const wordCount = fullText.split(/\s+/).length;
    const estimatedDuration = Math.round((wordCount / 150) * 60);

    await db
      .update(article)
      .set({
        audioUrl: key,
        audioDurationSeconds: estimatedDuration,
        // Stash the profile tag so we can invalidate on model/voice change.
        audioTimestamps: JSON.stringify({ profile: ttsProfileTag() }),
      })
      .where(eq(article.id, articleId));

    console.log(`[Audio] Done for ${articleId} (${combined.length} bytes)`);
  } catch (error) {
    console.error(`[Audio] Generation failed for ${articleId}:`, error);
    await db
      .update(article)
      .set({ audioUrl: null })
      .where(eq(article.id, articleId));
  }
}

// POST — Generate audio (returns immediately, runs in background)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await params;

  const [row] = await db
    .select()
    .from(article)
    .where(and(eq(article.id, id), eq(article.userId, session.user.id)))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  // Check if existing audio was generated with the current TTS profile.
  const currentProfile = ttsProfileTag();
  let storedProfile: string | null = null;
  if (row.audioTimestamps) {
    try {
      const parsed = JSON.parse(row.audioTimestamps) as { profile?: string };
      storedProfile = parsed.profile ?? null;
    } catch {
      /* old-format whisper timestamps — treat as profile-less */
    }
  }
  const profileMatches = storedProfile === currentProfile;

  if (row.audioUrl && row.audioUrl !== "generating" && profileMatches) {
    return NextResponse.json({ audioUrl: getPublicUrl(row.audioUrl) });
  }
  if (row.audioUrl === "generating") {
    return NextResponse.json({ status: "generating" });
  }
  if (!row.translatedContent) {
    return NextResponse.json(
      { error: "Article translation not complete" },
      { status: 400 },
    );
  }

  await db
    .update(article)
    .set({ audioUrl: "generating" })
    .where(eq(article.id, id));

  generateAudioInBackground(
    id,
    row.translatedContent,
    row.targetLanguage,
  ).catch((err) =>
    console.error(`[Audio] Unhandled error for ${id}:`, err),
  );

  return NextResponse.json({ status: "generating" });
}
