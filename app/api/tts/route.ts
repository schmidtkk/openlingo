import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { generateSpeech } from "@/lib/tts";
import { normalizeVoiceId, resolveTTSLanguageCode } from "@/lib/tts-voice";
import { getAudio } from "@/lib/r2";

const AUDIO_CACHE_ROOT = path.join(process.cwd(), ".audio-cache");
// Matches `local/<bucket>/<file>.mp3` where bucket and filename only contain
// safe chars (no dots, no slashes) — so path traversal is impossible.
const LOCAL_KEY_PATTERN = /^local\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  if (key.startsWith("local/")) {
    if (!LOCAL_KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: "invalid key" }, { status: 400 });
    }
    const relative = key.slice("local/".length);
    const filePath = path.resolve(AUDIO_CACHE_ROOT, relative);
    if (!filePath.startsWith(AUDIO_CACHE_ROOT + path.sep)) {
      return NextResponse.json({ error: "invalid key" }, { status: 400 });
    }
    const data = await fs.readFile(filePath).catch(() => null);
    if (!data) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const buffer = await getAudio(key);
  if (!buffer) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { text, language, voice } = body;

  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (!language || typeof language !== "string") {
    return NextResponse.json(
      { error: "language is required" },
      { status: 400 }
    );
  }
  if (text.length > 4096) {
    return NextResponse.json(
      { error: "text must be under 4096 characters" },
      { status: 400 }
    );
  }
  const preferredVoice =
    voice === undefined || voice === null ? undefined : normalizeVoiceId(voice);
  if ((voice !== undefined && voice !== null) && !preferredVoice) {
    return NextResponse.json(
      { error: "voice must be an alphanumeric id with dashes or underscores" },
      { status: 400 },
    );
  }
  const ttsLanguage = resolveTTSLanguageCode(language, text);

  try {
    const url = await generateSpeech(text, ttsLanguage, preferredVoice);
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS generation failed";
    console.error("[tts] generation failed:", message);
    return NextResponse.json(
      { error: "TTS service unavailable", detail: message },
      { status: 503 },
    );
  }
}
