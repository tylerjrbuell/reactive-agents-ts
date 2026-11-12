/**
 * Web-search provider keys saved through Settings · Web search.
 *
 * They share the encrypted provider key store (`provider-key-store.ts`) under ids
 * `websearch-<provider>`; the Providers panel lists LLM providers only and the Web search
 * panel lists these. The provider set and env names mirror the framework's web-search chain
 * (`packages/tools/src/skills/web-search.ts`): Tavily, Brave, Serper, Keenable, then
 * DuckDuckGo instant answers (no key). The framework exports no provider list, so this table
 * is a Cortex-side copy; the docs-sync rule `web-search-providers` is the drift guard.
 *
 * Reach: the framework's `web-search` handler reads these keys from `process.env` at call
 * time and has no builder option for them, so a stored key does NOT reach agents yet
 * (`appliesToAgents` stays false for these ids; see `AGENT_APPLIES`). Cortex does not write
 * `process.env`: shell and code-execute tools would inherit it.
 *
 * Nothing here throws; the probe returns a tagged result and never echoes a key.
 */

/** Key-store id prefix of the web-search provider keys. */
export const WEB_SEARCH_KEY_PREFIX = "websearch-";

/** One web-search provider that takes an API key. */
export interface WebSearchProviderInfo {
  /** Key-store id (`websearch-<name>`). */
  readonly id: string;
  /** Name shown in Settings. */
  readonly label: string;
  /** Env variables the framework reads for it (first is the canonical name). */
  readonly env: readonly string[];
}

/** Keyed web-search providers, in the framework's fallback order. */
export const WEB_SEARCH_PROVIDERS: readonly WebSearchProviderInfo[] = [
  { id: "websearch-tavily", label: "Tavily", env: ["TAVILY_API_KEY"] },
  { id: "websearch-brave", label: "Brave Search", env: ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"] },
  { id: "websearch-serper", label: "Serper (Google)", env: ["SERPER_API_KEY"] },
  { id: "websearch-keenable", label: "Keenable", env: ["KEENABLE_API_KEY"] },
];

/** Entries for `KEYED_PROVIDER_ENV`. */
export const WEB_SEARCH_KEYED_ENV: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  WEB_SEARCH_PROVIDERS.map((p) => [p.id, p.env]),
);

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
