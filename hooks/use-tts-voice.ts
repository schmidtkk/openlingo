"use client";

import { useCallback, useSyncExternalStore } from "react";

export const TTS_VOICE_STORAGE_KEY = "openlingo.ttsVoice";

const VOICE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const TTS_VOICE_CHANGE_EVENT = "openlingo:tts-voice-change";

export function normalizeClientVoiceId(
  voice?: string | null,
): string | undefined {
  if (typeof voice !== "string") return undefined;
  const trimmed = voice.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  return VOICE_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function getStoredTTSVoice(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return normalizeClientVoiceId(
    window.localStorage.getItem(TTS_VOICE_STORAGE_KEY),
  );
}

function subscribeToTTSVoice(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(TTS_VOICE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(TTS_VOICE_CHANGE_EVENT, callback);
  };
}

export function useTTSVoice() {
  const voice = useSyncExternalStore(
    subscribeToTTSVoice,
    getStoredTTSVoice,
    () => undefined,
  );
  const setVoice = useCallback((nextVoice: string) => {
    const normalized = normalizeClientVoiceId(nextVoice);
    if (!normalized || typeof window === "undefined") return;
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, normalized);
    window.dispatchEvent(new Event(TTS_VOICE_CHANGE_EVENT));
  }, []);

  return { voice, setVoice };
}
