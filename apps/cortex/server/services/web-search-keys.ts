/**
 * Web-search provider keys saved through Settings · Web search.
 *
 * They share the encrypted provider key store (`provider-key-store.ts`) under ids
 * `websearch-<provider>`; the Providers panel lists LLM providers only and the Web search
 * panel lists these. The provider set and env names come from the framework's own chain
 * (`WEB_SEARCH_PROVIDERS` in `@reactive-agents/tools`), so a provider the framework adds
 * appears here without a table edit; only its display label is Cortex copy.
 *
 * Reach: `cortexAgentBuilder` passes the saved keys as `.withTools({ webSearch: { apiKeys } })`
 * (see {@link webSearchOptionOf}). Keys are runtime-only in the framework (never in
 * `AgentConfig` JSON, traces or tool results) and Cortex never writes `process.env`: shell and
 * code-execute tools would inherit it. Precedence is the provider-key rule: an env key wins
 * unless the user chose "use stored key".
 *
 * Nothing here throws; the probe returns a tagged result and never echoes a key.
 */
import { WEB_SEARCH_PROVIDERS, type WebSearchProvider } from "@reactive-agents/tools";

/** Key-store id prefix of the web-search provider keys. */
export const WEB_SEARCH_KEY_PREFIX = "websearch-";

/** One web-search provider that takes an API key. */
export interface WebSearchProviderInfo {
  /** Key-store id (`websearch-<name>`). */
  readonly id: string;
  /** The framework's provider id (`tavily`, `brave`, ...). */
  readonly provider: WebSearchProvider;
  /** Name shown in Settings. */
  readonly label: string;
  /** Env variables the framework reads for it (first is the canonical name). */
  readonly env: readonly string[];
}

/** Display names; a provider the framework adds without an entry shows its id. */
const LABELS: Readonly<Record<string, string>> = {
  tavily: "Tavily",
  brave: "Brave Search",
  serper: "Serper (Google)",
  keenable: "Keenable",
};

/** Keyed web-search providers, in the framework's fallback order (DuckDuckGo takes no key). */
export const WEB_SEARCH_KEY_PROVIDERS: readonly WebSearchProviderInfo[] = WEB_SEARCH_PROVIDERS.filter(
  (p) => p.envVars.length > 0,
).map((p) => ({
  id: `${WEB_SEARCH_KEY_PREFIX}${p.id}`,
  provider: p.id,
  label: LABELS[p.id] ?? p.id,
  env: p.envVars,
}));

/** Entries for `KEYED_PROVIDER_ENV`. */
export const WEB_SEARCH_KEYED_ENV: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  WEB_SEARCH_KEY_PROVIDERS.map((p) => [p.id, p.env]),
);

/** Key-store ids of the web-search keys that reach agents (all of them). */
export const WEB_SEARCH_KEY_IDS: readonly string[] = WEB_SEARCH_KEY_PROVIDERS.map((p) => p.id);

/** The `webSearch` value of `.withTools()`: runtime-only keys plus the serialized provider order. */
export interface WebSearchOption {
  readonly apiKeys: Partial<Record<Exclude<WebSearchProvider, "duckduckgo">, string>>;
  readonly providers?: readonly WebSearchProvider[];
}

/**
 * The `.withTools({ webSearch })` value for an agent: every saved key that wins its precedence
 * (`keyFor` is `providerKeyForAgent`), plus the provider order the agent's config already
 * carries (`withTools` replaces `webSearch` whole, so the order must be passed again).
 * Undefined when no saved key applies: the config's own `webSearch` is then left alone.
 */
export const webSearchOptionOf = (
  providers: readonly WebSearchProvider[] | undefined,
  keyFor: (id: string) => string | undefined,
): WebSearchOption | undefined => {
  const apiKeys: { -readonly [K in keyof WebSearchOption["apiKeys"]]: string } = {};
  for (const p of WEB_SEARCH_KEY_PROVIDERS) {
    const key = keyFor(p.id);
    if (key && p.provider !== "duckduckgo") apiKeys[p.provider] = key;
  }
  if (Object.keys(apiKeys).length === 0) return undefined;
  return providers ? { apiKeys, providers } : { apiKeys };
};

/** True for a web-search provider key id. */
export const isWebSearchKeyId = (id: string): boolean => id.startsWith(WEB_SEARCH_KEY_PREFIX);

/** Result of one key probe. `error` never contains the key. */
export type WebSearchProbeResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/** Probes one provider's key with a one-result search; injectable for tests (no network). */
export type WebSearchProbe = (id: string, apiKey: string, doFetch?: typeof fetch) => Promise<WebSearchProbeResult>;

const PROBE_QUERY = "test";
const PROBE_TIMEOUT_MS = 8_000;

const requestOf = (id: string, key: string): { readonly url: string; readonly init: RequestInit } | null => {
  const json = { "Content-Type": "application/json" };
  switch (id) {
    case "websearch-tavily":
      return {
        url: "https://api.tavily.com/search",
        init: { method: "POST", headers: json, body: JSON.stringify({ query: PROBE_QUERY, max_results: 1, api_key: key }) },
      };
    case "websearch-brave":
      return {
        url: `https://api.search.brave.com/res/v1/web/search?q=${PROBE_QUERY}&count=1`,
        init: { method: "GET", headers: { Accept: "application/json", "X-Subscription-Token": key } },
      };
    case "websearch-serper":
      return {
        url: "https://google.serper.dev/search",
        init: { method: "POST", headers: { ...json, "X-API-KEY": key }, body: JSON.stringify({ q: PROBE_QUERY, num: 1 }) },
      };
    case "websearch-keenable":
      return {
        url: "https://api.keenable.ai/v1/search",
        init: {
          method: "POST",
          headers: { ...json, "X-API-Key": key, "X-Keenable-Title": "reactive-agents" },
          body: JSON.stringify({ query: PROBE_QUERY, max_results: 1 }),
        },
      };
    default:
      return null;
  }
};

/**
 * Check a key with a one-result search against the provider's own API. A 2xx answer is a
 * pass (it spends one query of the provider's quota); 401/403 reads as a rejected key.
 */
export const probeWebSearchKey: WebSearchProbe = async (id, apiKey, doFetch = fetch) => {
  const req = requestOf(id, apiKey);
  if (!req) return { ok: false, error: `no web-search provider "${id}"` };
  try {
    const res = await doFetch(req.url, { ...req.init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), redirect: "error" });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: `The provider rejected the key (HTTP ${res.status}).` };
    return { ok: false, error: `The provider answered HTTP ${res.status}.` };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, error: name === "TimeoutError" ? "The provider did not answer in time." : "Could not reach the provider." };
  }
};
