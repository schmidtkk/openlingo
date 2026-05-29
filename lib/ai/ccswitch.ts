import { spawnSync } from "child_process";

export interface CcswitchProvider {
  id: string;
  label: string;
  provider: string;
}

export interface CcswitchCreds {
  baseURL: string;
  apiKey: string;
  model: string;
}

const SPAWN_TIMEOUT_MS = 5000;
const PROVIDER_LIST_TTL_MS = 30_000;
const CREDS_TTL_MS = 60_000;

let providerListCache: { value: CcswitchProvider[]; at: number } | null = null;
const credsCache = new Map<string, { value: CcswitchCreds; at: number }>();

function parseCcswitchList(output: string): CcswitchProvider[] {
  const allProviders: CcswitchProvider[] = [];
  const providersWithEndpoint: CcswitchProvider[] = [];
  const lineRe = /^\s{2}(\S+)\s+-\s+(.+)$/;
  const endpointRe = /^\s{4}endpoint:\s*(.*)$/;
  let current: CcswitchProvider | null = null;
  let sawEndpointLine = false;

  const commitCurrent = () => {
    if (current) allProviders.push(current);
  };

  for (const line of output.split("\n")) {
    const m = line.match(lineRe);
    if (m) {
      commitCurrent();
      current = {
        id: m[1].trim(),
        label: m[2].trim(),
        provider: "ccswitch",
      };
      continue;
    }

    const endpoint = line.match(endpointRe);
    if (endpoint && current) {
      sawEndpointLine = true;
      if (endpoint[1].trim()) providersWithEndpoint.push(current);
    }
  }

  commitCurrent();
  return sawEndpointLine ? providersWithEndpoint : allProviders;
}

function parseExports(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const m = line.match(/^export ([^=]+)='([^']*)'$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/** Returns ccswitch providers, cached for PROVIDER_LIST_TTL_MS. */
export function loadCcswitchProviders(): CcswitchProvider[] {
  const now = Date.now();
  if (providerListCache && now - providerListCache.at < PROVIDER_LIST_TTL_MS) {
    return providerListCache.value;
  }
  const result = spawnSync("ccswitch", ["list"], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    providerListCache = { value: [], at: now };
    return [];
  }
  const value = parseCcswitchList(result.stdout ?? "");
  providerListCache = { value, at: now };
  return value;
}

/**
 * Resolves creds for a ccswitch provider. Cached for CREDS_TTL_MS.
 * providerName is validated against the known provider list to prevent
 * arbitrary command argument injection (though spawnSync with array args
 * already avoids shell injection).
 */
export function resolveCcswitch(providerName: string): CcswitchCreds | null {
  if (!/^[A-Za-z0-9_.\-]+$/.test(providerName)) return null;

  const known = loadCcswitchProviders();
  if (known.length > 0 && !known.some((p) => p.id === providerName)) return null;

  const now = Date.now();
  const cached = credsCache.get(providerName);
  if (cached && now - cached.at < CREDS_TTL_MS) return cached.value;

  const result = spawnSync("ccswitch", ["use", providerName], {
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) return null;
  const env = parseExports(result.stdout ?? "");
  if (!env.ANTHROPIC_BASE_URL || !env.ANTHROPIC_AUTH_TOKEN) return null;
  // ccswitch's ANTHROPIC_BASE_URL follows @anthropic-ai/sdk convention
  // (SDK appends /v1/messages). @ai-sdk/anthropic expects baseURL to
  // already include /v1 (it only appends /messages). Normalize here.
  let baseURL = env.ANTHROPIC_BASE_URL.replace(/\/+$/, "");
  if (!/\/v\d+$/.test(baseURL)) baseURL += "/v1";
  const value: CcswitchCreds = {
    baseURL,
    apiKey: env.ANTHROPIC_AUTH_TOKEN,
    model: env.ANTHROPIC_MODEL || providerName,
  };
  credsCache.set(providerName, { value, at: now });
  return value;
}
