import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { audioCache } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { uploadAudio, getPublicUrl } from "@/lib/r2";
import {
  getDefaultTemplate,
  interpolateTemplate,
  langCodeToName,
} from "@/lib/prompts";
import {
  buildTTSCacheKey,
  buildTTSClientCacheKey,
  buildTTSProfileTag,
  resolveTTSVoice,
} from "@/lib/tts-voice";

const openai = new OpenAI();
const useLocalStorage = !process.env.R2_ACCOUNT_ID;

interface TTSClient {
  client: OpenAI;
  model: string;
  voice: string;
  /** Whether this client should be sent OpenAI's `instructions` field. */
  supportsInstructions: boolean;
}

/** Per-language client cache — avoids creating duplicate OpenAI instances. */
const _langClients = new Map<string, TTSClient>();

function buildClient(baseUrl: string, model: string, voice: string): TTSClient {
  const client = new OpenAI({
    baseURL: baseUrl + "/v1",
    apiKey: "local",
  });
  return { client, model, voice, supportsInstructions: false };
}

/** CJK ratio heuristic — returns 'zh' if >30% of chars are CJK, else 'en'. */
function detectLanguage(text: string): "zh" | "en" {
  let cjk = 0;
  let total = 0;
  for (const c of text) {
    if (c !== " ") {
      total++;
      if (c >= "一" && c <= "鿿") cjk++;
    }
  }
  return cjk > total * 0.3 ? "zh" : "en";
}

function _getLangCode(language: string, text?: string): string {
  // Map OpenLingo language codes to simple routing codes
  const lang = language.toLowerCase();
  if (lang === "zh" || lang === "chinese") return "zh";
  if (lang === "fr" || lang === "french") return "fr";
  if (lang === "en" || lang === "english") return "en";
  // Detect from text for non-English/French (Japanese, Korean, etc.)
  if (text) return detectLanguage(text);
  return "en";
}

/**
 * Returns a TTS client for the given language, respecting per-language URL
 * env vars. Falls back to LOCAL_TTS_URL if no per-language URL is set.
 *
 * Language routing (when per-language URLs are set):
 *   EN → LOCAL_TTS_URL_EN  (Kokoro, port 8880 — fast)
 *   FR → LOCAL_TTS_URL_FR  (Chatterbox-fast, port 8881)
 *   ZH → LOCAL_TTS_URL_ZH  (Chatterbox-fast, port 8881)
 */
export function getTTSClientForLanguage(
  language: string,
  text?: string,
  preferredVoice?: string,
): TTSClient {
  const langCode = _getLangCode(language, text);

  // Try per-language URL first
  const perLangUrl =
    process.env[`LOCAL_TTS_URL_${langCode.toUpperCase()}`];
  if (perLangUrl) {
    // Default: EN->Kokoro/af_heart, others->Chatterbox/default
    const model = langCode === "en" ? "kokoro" : "chatterbox";
    const voice = resolveTTSVoice(
      preferredVoice,
      undefined,
      langCode === "en" ? "af_heart" : "default",
    );
    const cacheKey = buildTTSClientCacheKey(langCode, voice);
    const cached = _langClients.get(cacheKey);
    if (cached) return cached;
    const client = buildClient(perLangUrl, model, voice);
    _langClients.set(cacheKey, client);
    return client;
  }

  // Fall back to single LOCAL_TTS_URL
  if (process.env.LOCAL_TTS_URL) {
    const model = process.env.LOCAL_TTS_MODEL ?? "kokoro";
    const voice = resolveTTSVoice(
      preferredVoice,
      process.env.LOCAL_TTS_VOICE,
      "af_heart",
    );
    const cacheKey = buildTTSClientCacheKey("_default", voice);
    const cached = _langClients.get(cacheKey);
    if (cached) return cached;
    const client = buildClient(
      process.env.LOCAL_TTS_URL,
      model,
      voice,
    );
    _langClients.set(cacheKey, client);
    return client;
  }

  // OpenAI cloud TTS
  const voice = resolveTTSVoice(preferredVoice, undefined, "coral");
  return {
    client: openai,
    model: "gpt-4o-mini-tts",
    voice,
    supportsInstructions: true,
  };
}

/** @deprecated — use getTTSClientForLanguage() for per-language routing. */
export function getTTSClient(preferredVoice?: string): TTSClient {
  if (process.env.LOCAL_TTS_URL) {
    const voice = resolveTTSVoice(
      preferredVoice,
      process.env.LOCAL_TTS_VOICE,
      "af_heart",
    );
    const local = new OpenAI({
      baseURL: process.env.LOCAL_TTS_URL + "/v1",
      apiKey: "local",
    });
    return {
      client: local,
      model: process.env.LOCAL_TTS_MODEL ?? "kokoro",
      voice,
      supportsInstructions: false,
    };
  }
  const voice = resolveTTSVoice(preferredVoice, undefined, "coral");
  return {
    client: openai,
    model: "gpt-4o-mini-tts",
    voice,
    supportsInstructions: true,
  };
}

/** Profile tag used in cache keys — invalidates audio when model/voice changes. */
export function ttsProfileTag(
  language?: string,
  text?: string,
  preferredVoice?: string,
): string {
  const { model, voice } = language
    ? getTTSClientForLanguage(language, text, preferredVoice)
    : getTTSClient(preferredVoice);
  return buildTTSProfileTag(model, voice);
}

/** Lowest-level audio generation. Throws on provider failure. */
export async function generateAudioBuffer(
  text: string,
  instructions?: string,
  language?: string,
  preferredVoice?: string,
): Promise<Buffer> {
  const { client, model, voice, supportsInstructions } =
    getTTSClientForLanguage(language ?? "en", text, preferredVoice);
  const res = await client.audio.speech.create({
    model,
    voice: voice as "alloy",
    input: text,
    response_format: "mp3",
    ...(supportsInstructions && instructions ? { instructions } : {}),
  });
  return Buffer.from(await res.arrayBuffer());
}

async function storeAudio(
  hash: string,
  language: string,
  buffer: Buffer,
): Promise<string> {
  if (useLocalStorage) {
    const dir = path.join(process.cwd(), ".audio-cache", language);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${hash}.mp3`), buffer);
    return `local/${language}/${hash}.mp3`;
  }
  const key = `audio/${language}/${hash}.mp3`;
  await uploadAudio(key, buffer);
  return key;
}

// Process-level dedup so two concurrent requests for the same text don't
// fan out into two upstream TTS calls. Cache key includes language so
// the same word in two languages still both generate.
const inflight = new Map<string, Promise<string>>();

export async function generateSpeech(
  text: string,
  language: string,
  preferredVoice?: string,
): Promise<string> {
  const normalized = text.toLowerCase();
  const profile = ttsProfileTag(language, normalized, preferredVoice);
  const cacheKey = buildTTSCacheKey(profile, normalized);
  const dedupKey = `${language}:${cacheKey}`;

  const existing = inflight.get(dedupKey);
  if (existing) return existing;

  const work = (async () => {
    const cached = await db
      .select()
      .from(audioCache)
      .where(
        and(eq(audioCache.text, cacheKey), eq(audioCache.language, language)),
      )
      .limit(1);
    if (cached.length > 0) return getPublicUrl(cached[0].r2Key);

    const target_language = langCodeToName[language] || "the target language";
    const ttsTemplate = getDefaultTemplate("tts-instructions");
    const instructions = interpolateTemplate(ttsTemplate, { target_language });

    const buffer = await generateAudioBuffer(
      normalized,
      instructions,
      language,
      preferredVoice,
    );
    const hash = createHash("md5").update(cacheKey).digest("hex");
    const r2Key = await storeAudio(hash, language, buffer);

    await db
      .insert(audioCache)
      .values({ text: cacheKey, language, r2Key })
      .onConflictDoNothing();

    return getPublicUrl(r2Key);
  })();

  inflight.set(dedupKey, work);
  try {
    return await work;
  } finally {
    inflight.delete(dedupKey);
  }
}
