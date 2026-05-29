import path from "path";

const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const AUDIO_HASH_PATTERN = /^[A-Za-z0-9_-]+$/;

export type TTSVoiceOption = {
  id: string;
  name: string;
  language: string | null;
};

export const OPENAI_TTS_VOICE_OPTIONS: TTSVoiceOption[] = [
  { id: "alloy", name: "Alloy", language: null },
  { id: "ash", name: "Ash", language: null },
  { id: "ballad", name: "Ballad", language: null },
  { id: "coral", name: "Coral", language: null },
  { id: "echo", name: "Echo", language: null },
  { id: "sage", name: "Sage", language: null },
  { id: "shimmer", name: "Shimmer", language: null },
  { id: "verse", name: "Verse", language: null },
  { id: "marin", name: "Marin", language: null },
  { id: "cedar", name: "Cedar", language: null },
];

const OPENAI_TTS_VOICE_IDS = new Set(
  OPENAI_TTS_VOICE_OPTIONS.map((voice) => voice.id),
);

const TTS_LANGUAGE_ALIASES: Record<string, string> = {
  ar: "ar",
  arabic: "ar",
  de: "de",
  german: "de",
  en: "en",
  english: "en",
  es: "es",
  spanish: "es",
  fr: "fr",
  french: "fr",
  hi: "hi",
  hindi: "hi",
  it: "it",
  italian: "it",
  ja: "ja",
  japanese: "ja",
  "japanese hiragana": "ja",
  ko: "ko",
  korean: "ko",
  mandarin: "zh",
  "mandarin chinese": "zh",
  pt: "pt",
  portuguese: "pt",
  ru: "ru",
  russian: "ru",
  zh: "zh",
  chinese: "zh",
};

export function normalizeVoiceId(voice?: string | null): string | undefined {
  if (typeof voice !== "string") return undefined;
  const trimmed = voice.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  return VOICE_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function resolveTTSVoice(
  preferredVoice: string | undefined | null,
  fallbackVoice: string | undefined,
  defaultVoice: string,
): string {
  return normalizeVoiceId(preferredVoice) ?? fallbackVoice ?? defaultVoice;
}

export function resolveOpenAITTSVoice(
  preferredVoice?: string | null,
  defaultVoice = "coral",
): string {
  const normalized = normalizeVoiceId(preferredVoice);
  if (normalized && OPENAI_TTS_VOICE_IDS.has(normalized)) {
    return normalized;
  }
  return OPENAI_TTS_VOICE_IDS.has(defaultVoice) ? defaultVoice : "coral";
}

function detectTTSLanguageFromText(text: string): "zh" | "en" {
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

export function resolveTTSLanguageCode(
  language: string | null | undefined,
  text?: string,
): string {
  const raw = typeof language === "string" ? language.trim().toLowerCase() : "";
  const normalized = raw.replace(/[_-]+/g, " ");
  const regionalCode = raw.match(/^([a-z]{2})(?:[-_][a-z]{2})$/)?.[1];

  return (
    TTS_LANGUAGE_ALIASES[raw] ??
    TTS_LANGUAGE_ALIASES[normalized] ??
    (regionalCode ? TTS_LANGUAGE_ALIASES[regionalCode] : undefined) ??
    (text ? detectTTSLanguageFromText(text) : "en")
  );
}

export function buildLocalAudioCacheEntry(
  cacheRoot: string,
  language: string,
  hash: string,
  text?: string,
): { language: string; filePath: string; publicKey: string } {
  if (!AUDIO_HASH_PATTERN.test(hash)) {
    throw new Error("invalid audio cache hash");
  }

  const safeLanguage = resolveTTSLanguageCode(language, text);
  const root = path.resolve(cacheRoot);
  const filePath = path.resolve(root, safeLanguage, `${hash}.mp3`);
  if (!filePath.startsWith(root + path.sep)) {
    throw new Error("invalid audio cache path");
  }

  return {
    language: safeLanguage,
    filePath,
    publicKey: `local/${safeLanguage}/${hash}.mp3`,
  };
}

export function buildTTSProfileTag(model: string, voice: string): string {
  return `${model}:${voice}`;
}

export function buildTTSCacheKey(profile: string, normalizedText: string): string {
  return `${profile}|${normalizedText}`;
}

export function buildTTSClientCacheKey(langCode: string, voice: string): string {
  return `${langCode}:${voice}`;
}
