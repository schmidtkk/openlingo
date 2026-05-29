const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

export function buildTTSProfileTag(model: string, voice: string): string {
  return `${model}:${voice}`;
}

export function buildTTSCacheKey(profile: string, normalizedText: string): string {
  return `${profile}|${normalizedText}`;
}

export function buildTTSClientCacheKey(langCode: string, voice: string): string {
  return `${langCode}:${voice}`;
}
