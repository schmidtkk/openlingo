"use client";

import { useEffect, useMemo, useState } from "react";
import { useTTSVoice } from "@/hooks/use-tts-voice";

type VoiceOption = {
  id: string;
  name: string;
  language: string | null;
};

type VoicesResponse = {
  model: string;
  defaultVoice?: string;
  voices: VoiceOption[];
};

export function VoiceSelector() {
  const { voice, setVoice } = useTTSVoice();
  const [model, setModel] = useState("");
  const [defaultVoice, setDefaultVoice] = useState<string | undefined>();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadVoices() {
      setLoading(true);
      try {
        const res = await fetch("/api/voices", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | VoicesResponse
          | null;
        if (cancelled || !data || !Array.isArray(data.voices)) return;
        setModel(data.model);
        setDefaultVoice(data.defaultVoice);
        setVoices(data.voices);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadVoices();
    return () => {
      cancelled = true;
    };
  }, []);

  const voiceIds = useMemo(() => new Set(voices.map((v) => v.id)), [voices]);
  const defaultSelection =
    defaultVoice && voiceIds.has(defaultVoice) ? defaultVoice : voices[0]?.id;
  const selectedVoice =
    voice && voiceIds.has(voice) ? voice : defaultSelection ?? "";

  useEffect(() => {
    if (voices.length === 0) return;
    if (defaultSelection && (!voice || !voiceIds.has(voice))) {
      setVoice(defaultSelection);
    }
  }, [defaultSelection, voice, voiceIds, voices, setVoice]);

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <span className="text-sm font-bold text-lingo-text-light">Voice</span>
        {model && (
          <p className="mt-0.5 text-xs font-bold uppercase text-lingo-text-light/60">
            {model}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <select
          value={selectedVoice}
          disabled={loading || voices.length === 0}
          onChange={(e) => {
            setVoice(e.target.value);
            setChanged(true);
          }}
          className="max-w-44 rounded-lg border-2 border-lingo-border bg-lingo-card px-3 py-1.5 text-sm font-bold text-lingo-text disabled:opacity-50"
        >
          {loading && <option value="">Loading voices</option>}
          {!loading && voices.length === 0 && (
            <option value="">No voices available</option>
          )}
          {voices.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.language ? ` (${option.language})` : ""}
            </option>
          ))}
        </select>
        {changed && (
          <span className="max-w-44 text-right text-xs font-bold text-lingo-green">
            Voice changed. Replay audio to regenerate.
          </span>
        )}
      </div>
    </div>
  );
}
