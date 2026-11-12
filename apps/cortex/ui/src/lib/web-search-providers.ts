/**
 * Pure rules for the web-search provider order control (Lab · Tools). The order is the
 * framework's `tools.webSearch.providers` (an ordered subset of the search chain; a provider
 * left out is never tried), stored in `rawConfig` like every other AgentConfig path. API keys
 * are not part of it: they live in Settings · Web search and are passed in code by the server.
 *
 * The id list mirrors the framework's `WEB_SEARCH_PROVIDERS` (`@reactive-agents/tools`); the
 * UI cannot import that package, so `server/tests/web-search-keys.test.ts` pins the two together.
 */

type Cfg = Record<string, unknown>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** One search backend the agent can use. */
export interface WebSearchChoice {
  /** The framework's provider id (what `providers` holds). */
  readonly id: string;
  readonly label: string;
  /** True when the provider needs an API key (Settings · Web search or an environment variable). */
  readonly keyed: boolean;
}

/** All providers, in the framework's default order. */
export const WEB_SEARCH_CHOICES: readonly WebSearchChoice[] = [
  { id: "tavily", label: "Tavily", keyed: true },
  { id: "brave", label: "Brave Search", keyed: true },
  { id: "serper", label: "Serper (Google)", keyed: true },
  { id: "keenable", label: "Keenable", keyed: true },
  { id: "duckduckgo", label: "DuckDuckGo (no key)", keyed: false },
];

const KNOWN: ReadonlySet<string> = new Set(WEB_SEARCH_CHOICES.map((c) => c.id));

/** The chosen provider order in a config, or `undefined` when none is set (the full default chain). */
export function webSearchOrder(cfg: Cfg): readonly string[] | undefined {
  const raw = obj(obj(cfg.rawConfig).tools).webSearch;
  const providers = obj(raw).providers;
  if (!Array.isArray(providers)) return undefined;
  const ids = providers.filter((p): p is string => typeof p === "string" && KNOWN.has(p));
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

/** Add `id` at the end of the order, or take it out when present. Picking is ordering: first pick is tried first. */
export function toggleWebSearchProvider(order: readonly string[] | undefined, id: string): string[] {
  const current = order ?? [];
  return current.includes(id) ? current.filter((p) => p !== id) : [...current, id];
}

/** `rawConfig` with `tools.webSearch.providers` set, or removed when `order` is empty/undefined. Other keys are kept. */
export function webSearchPatch(cfg: Cfg, order: readonly string[] | undefined): { rawConfig: Record<string, unknown> } {
  const raw = { ...obj(cfg.rawConfig) };
  const tools = { ...obj(raw.tools) };
  const webSearch = { ...obj(tools.webSearch) };
  if (order && order.length > 0) webSearch.providers = [...order];
  else delete webSearch.providers;
  if (Object.keys(webSearch).length > 0) tools.webSearch = webSearch;
  else delete tools.webSearch;
  if (Object.keys(tools).length > 0) raw.tools = tools;
  else delete raw.tools;
  return { rawConfig: raw };
}

/** The label of a provider id (the id itself when unknown). */
export function webSearchLabel(id: string): string {
  return WEB_SEARCH_CHOICES.find((c) => c.id === id)?.label ?? id;
}

/** One line stating the order in force: "Tavily, then Brave Search" or the default chain. */
export function webSearchSummary(order: readonly string[] | undefined): string {
  if (!order) return "Default: every provider that has a key, in the order shown, then DuckDuckGo.";
  const names = order.map((id) => webSearchLabel(id));
  return `Tried in this order: ${names.join(", then ")}. Providers left out are never used.`;
}
