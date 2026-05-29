import { createProviderRegistry } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { loadCcswitchProviders, resolveCcswitch } from "./ccswitch.ts";
import { DEFAULT_AI_MODEL } from "../constants.ts";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_AI_API_KEY,
});

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = createAnthropic({
  baseURL: process.env.LLM_PROXY_URL,
  apiKey: process.env.LLM_PROXY_API_KEY,
});

const registry = createProviderRegistry({ google, openai, anthropic });

export const AVAILABLE_MODELS: {
  id: string;
  label: string;
  provider: string;
}[] = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", provider: "google" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", provider: "google" },
  {
    id: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    provider: "google",
  },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
  },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
];

/** Models available to regular (non-admin) users in the chat UI. */
export const CHAT_AVAILABLE_MODELS = AVAILABLE_MODELS.filter(
  (m) => m.id === "claude-sonnet-4-6",
);

function getStaticDefaultModel() {
  return (
    AVAILABLE_MODELS.find((m) => m.id === DEFAULT_AI_MODEL) ??
    AVAILABLE_MODELS[0]
  );
}

/** Lazily-resolved ccswitch providers (refreshed by loadCcswitchProviders's TTL). */
function devModeModels() {
  return process.env.LOCAL_DEV === "true" ? loadCcswitchProviders() : [];
}

/** Comma-separated list of admin emails loaded from env. */
const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Returns the default model ID: first ccswitch provider in dev, otherwise the constant. */
export function getDefaultModel(): string {
  if (process.env.LOCAL_DEV === "true") {
    const list = devModeModels();
    if (list.length > 0) return list[0].id;
  }
  return getStaticDefaultModel().id;
}

/** Returns the model list appropriate for the given user email. */
export function getModelsForUser(email: string | null | undefined) {
  if (process.env.LOCAL_DEV === "true") {
    const localModels = devModeModels();
    if (localModels.length > 0) return localModels;
  }
  return isAdminEmail(email) ? AVAILABLE_MODELS : CHAT_AVAILABLE_MODELS;
}

export function resolveModelIdForUser(
  id: string | null | undefined,
  email: string | null | undefined,
) {
  const userModels = getModelsForUser(email);
  if (typeof id === "string" && userModels.some((m) => m.id === id)) {
    return id;
  }

  const fallback = getDefaultModel();
  if (userModels.some((m) => m.id === fallback)) return fallback;
  return userModels[0]?.id ?? fallback;
}

export function getModel(id: string | null | undefined) {
  const requestedId = typeof id === "string" ? id : "";

  if (process.env.LOCAL_DEV === "true") {
    const creds = requestedId ? resolveCcswitch(requestedId) : null;
    if (creds) {
      return createAnthropic({ baseURL: creds.baseURL, apiKey: creds.apiKey })
        .languageModel(creds.model);
    }
  }

  const staticModel =
    AVAILABLE_MODELS.find((m) => m.id === requestedId) ??
    getStaticDefaultModel();
  const resolved = `${staticModel.provider}:${staticModel.id}`;
  return registry.languageModel(
    resolved as Parameters<typeof registry.languageModel>[0],
  );
}
