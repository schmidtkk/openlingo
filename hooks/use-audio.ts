"use client";

import { useRef, useCallback, useState } from "react";
import { getStoredTTSVoice } from "@/hooks/use-tts-voice";

// In-memory URL cache to avoid redundant API calls (success only).
const urlCache = new Map<string, string>();
// In-flight requests for the same (language, text) pair are coalesced so
// rapid clicks don't fan out into duplicate /api/tts POSTs.
const inflight = new Map<string, Promise<string | null>>();

async function requestUrl(
  text: string,
  language: string,
  voice?: string,
): Promise<string | null> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language, ...(voice ? { voice } : {}) }),
  });
  if (!res.ok) {
    console.warn(`[use-audio] /api/tts ${res.status}`);
    return null;
  }
  const data = (await res.json().catch(() => null)) as { url?: string } | null;
  return typeof data?.url === "string" ? data.url : null;
}

export function useAudio() {
  const currentAudio = useRef<HTMLAudioElement | null>(null);
  const nonceRef = useRef(0);
  const [loading, setLoading] = useState(false);

  const stop = useCallback(() => {
    nonceRef.current++;
    setLoading(false);
    if (currentAudio.current) {
      currentAudio.current.pause();
      currentAudio.current = null;
    }
  }, []);

  const fetchUrl = useCallback(async (text: string, language: string) => {
    const voice = getStoredTTSVoice();
    const key = `${language}:${voice ?? "_default"}:${text.toLowerCase()}`;
    const cached = urlCache.get(key);
    if (cached) return cached;

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = requestUrl(text, language, voice).then((url) => {
      inflight.delete(key);
      if (url) urlCache.set(key, url);
      return url;
    });
    inflight.set(key, promise);
    return promise;
  }, []);

  const play = useCallback(
    async (text: string, language: string) => {
      stop();
      const nonce = nonceRef.current;

      setLoading(true);
      let url: string | null = null;
      try {
        url = await fetchUrl(text, language);
      } finally {
        if (nonce === nonceRef.current) setLoading(false);
      }

      // Stale or failed
      if (nonce !== nonceRef.current || !url) return;

      const audio = new Audio(url);
      currentAudio.current = audio;
      audio.play().catch(() => {});
    },
    [stop, fetchUrl],
  );

  // Throttled prefetch: at most 4 concurrent requests so we don't
  // saturate the TTS server when a long article mounts.
  const prefetch = useCallback(
    async (texts: string[], language: string) => {
      const queue = [...texts];
      const workers = new Array(Math.min(4, queue.length)).fill(0).map(async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === undefined) return;
          await fetchUrl(next, language);
        }
      });
      await Promise.allSettled(workers);
    },
    [fetchUrl],
  );

  return { play, stop, prefetch, loading };
}
