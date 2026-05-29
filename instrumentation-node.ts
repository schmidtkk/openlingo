import { createRequire } from "module";

// Node-only proxy setup. This file is imported exclusively from
// instrumentation.ts under a NEXT_RUNTIME === "nodejs" guard, so it is
// never included in the Edge bundle.
export function setupProxy() {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!proxyUrl) return;

  // undici is a transitive dep of Next, not in our package.json, so a
  // static import would fail bundler resolution. Resolve it at runtime.
  const requireFromHere = createRequire(import.meta.url);
  const undiciSpec = ["und", "ici"].join("");

  let undici: {
    ProxyAgent: new (url: string) => unknown;
    setGlobalDispatcher: (d: unknown) => void;
    EnvHttpProxyAgent?: new (opts: {
      httpProxy?: string;
      httpsProxy?: string;
      noProxy?: string;
    }) => unknown;
  };
  try {
    undici = requireFromHere(undiciSpec);
  } catch {
    console.warn("[instrumentation] undici not available; proxy not applied");
    return;
  }

  const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";

  if (typeof undici.EnvHttpProxyAgent === "function") {
    undici.setGlobalDispatcher(
      new undici.EnvHttpProxyAgent({
        httpProxy: proxyUrl,
        httpsProxy: proxyUrl,
        noProxy,
      }),
    );
  } else {
    undici.setGlobalDispatcher(new undici.ProxyAgent(proxyUrl));
  }

  console.log(
    `[instrumentation] HTTP proxy enabled: ${proxyUrl} (no_proxy=${noProxy || "(none)"})`,
  );
}
