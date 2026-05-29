import { NextRequest, NextResponse } from "next/server";
import { normalizeVoiceId } from "@/lib/tts-voice";

export const dynamic = "force-dynamic";

type VoiceOption = {
  id: string;
  name: string;
  language: string | null;
};

const FALLBACK_VOICES: Record<string, VoiceOption[]> = {
  voxtral: [
    { id: "fr_male", name: "French Male", language: "fr" },
    { id: "fr_female", name: "French Female", language: "fr" },
    { id: "casual_male", name: "Casual Male", language: null },
    { id: "casual_female", name: "Casual Female", language: null },
    { id: "neutral_male", name: "Neutral Male", language: null },
    { id: "neutral_female", name: "Neutral Female", language: null },
    { id: "de_male", name: "German Male", language: "de" },
    { id: "de_female", name: "German Female", language: "de" },
    { id: "es_male", name: "Spanish Male", language: "es" },
    { id: "es_female", name: "Spanish Female", language: "es" },
    { id: "it_male", name: "Italian Male", language: "it" },
    { id: "it_female", name: "Italian Female", language: "it" },
  ],
  chatterbox: [
    { id: "default", name: "Default", language: null },
    { id: "en_us", name: "English US", language: "en" },
    { id: "en_gb", name: "English UK", language: "en" },
    { id: "fr", name: "French", language: "fr" },
    { id: "zh", name: "Chinese", language: "zh" },
  ],
  kokoro: [
    { id: "af_heart", name: "American Female Heart", language: "en" },
    { id: "af_bella", name: "American Female Bella", language: "en" },
    { id: "am_adam", name: "American Male Adam", language: "en" },
    { id: "am_michael", name: "American Male Michael", language: "en" },
    { id: "bf_emma", name: "British Female Emma", language: "en" },
    { id: "bm_george", name: "British Male George", language: "en" },
  ],
  cosyvoice3: [
    { id: "default", name: "Default", language: "zh" },
    { id: "zh_female", name: "Chinese Female", language: "zh" },
    { id: "zh_male", name: "Chinese Male", language: "zh" },
    { id: "en_female", name: "English Female", language: "en" },
  ],
  f5tts: [
    { id: "default", name: "Default", language: "en" },
    { id: "en_male", name: "English Male", language: "en" },
    { id: "zh_female", name: "Chinese Female", language: "zh" },
  ],
  qwen3tts: [
    { id: "serena", name: "Serena", language: "en" },
    { id: "vivian", name: "Vivian", language: "zh" },
    { id: "sohee", name: "Sohee", language: "ko" },
    { id: "ono_anna", name: "Ono Anna", language: "ja" },
  ],
  mosstts: [
    { id: "default", name: "Default", language: "zh" },
    { id: "broadcast_calm", name: "Broadcast Calm", language: "zh" },
    { id: "broadcast_lively", name: "Broadcast Lively", language: "zh" },
    {
      id: "broadcast_authoritative",
      name: "Broadcast Authoritative",
      language: "zh",
    },
  ],
};

function titleFromId(id: string): string {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferLanguageFromVoiceId(id: string): string | null {
  if (id === "fr" || id.startsWith("fr_")) return "fr";
  if (id === "zh" || id.startsWith("zh_")) return "zh";
  if (id.startsWith("en_")) return "en";
  if (id.startsWith("de_")) return "de";
  if (id.startsWith("es_")) return "es";
  if (id.startsWith("it_")) return "it";
  if (id.startsWith("pt_")) return "pt";
  if (id.startsWith("nl_")) return "nl";
  if (id.startsWith("ar_")) return "ar";
  if (id.startsWith("hi_")) return "hi";
  if (/^[ab][fm]_/.test(id)) return "en";
  return null;
}

function normalizeRemoteVoice(raw: unknown): VoiceOption | null {
  if (typeof raw === "string") {
    const id = normalizeVoiceId(raw);
    return id ? { id, name: titleFromId(id), language: inferLanguageFromVoiceId(id) } : null;
  }

  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = normalizeVoiceId(
    typeof record.id === "string" ? record.id : undefined,
  );
  if (!id) return null;

  const language =
    typeof record.language === "string"
      ? record.language
      : inferLanguageFromVoiceId(id);
  const name = typeof record.name === "string" ? record.name : titleFromId(id);
  return { id, name, language };
}

async function fetchLocalVoices(): Promise<{
  model?: string;
  voices: VoiceOption[];
} | null> {
  if (!process.env.LOCAL_TTS_URL) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const baseUrl = process.env.LOCAL_TTS_URL.replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/v1/voices`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as
      | { model?: unknown; voices?: unknown }
      | null;
    if (!data || !Array.isArray(data.voices)) return null;
    const voices = data.voices
      .map(normalizeRemoteVoice)
      .filter((voice): voice is VoiceOption => voice !== null);
    if (voices.length === 0) return null;
    return {
      model: typeof data.model === "string" ? data.model : undefined,
      voices,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const modelParam = request.nextUrl.searchParams.get("model");
  const envModel = process.env.LOCAL_TTS_MODEL ?? "chatterbox";
  const requestedModel =
    normalizeVoiceId(modelParam) ??
    envModel;

  if (!modelParam || requestedModel === envModel) {
    const local = await fetchLocalVoices();
    if (local) {
      return NextResponse.json({
        model: local.model ?? requestedModel,
        defaultVoice: normalizeVoiceId(process.env.LOCAL_TTS_VOICE),
        voices: local.voices,
      });
    }
  }

  return NextResponse.json({
    model: requestedModel,
    defaultVoice: normalizeVoiceId(process.env.LOCAL_TTS_VOICE),
    voices: FALLBACK_VOICES[requestedModel] ?? FALLBACK_VOICES.chatterbox,
  });
}
