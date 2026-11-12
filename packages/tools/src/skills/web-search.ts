import { Effect, Redacted } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError, WebSearchProviderError, toToolError } from "../errors.js";

/**
 * Ordered web-search provider chain with the env var(s) each one reads (first
 * match wins). Default order of the handler; `duckduckgo` needs no key.
 */
export const WEB_SEARCH_PROVIDERS = [
  { id: "tavily", envVars: ["TAVILY_API_KEY"] },
  { id: "brave", envVars: ["BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY"] },
  { id: "serper", envVars: ["SERPER_API_KEY"] },
  { id: "keenable", envVars: ["KEENABLE_API_KEY"] },
  { id: "duckduckgo", envVars: [] },
] as const;

/** Which backend produced the result list (for debugging and traces). */
export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]["id"];

/** Providers that take an API key (everything except DuckDuckGo). */
export type WebSearchKeyedProvider = Exclude<WebSearchProvider, "duckduckgo">;

/**
 * Per-agent web-search configuration. Explicit keys win over environment
 * variables; a provider with no explicit key falls back to its env var(s).
 */
export type WebSearchConfig = {
  /** Explicit API keys per provider. Plain strings or `Redacted` values. */
  readonly apiKeys?: Partial<Record<WebSearchKeyedProvider, string | Redacted.Redacted<string>>>;
  /**
   * Ordered subset of providers to try. Omitted: the full default chain.
   * A provider left out is never tried (omit `duckduckgo` to disable the
   * keyless fallback).
   */
  readonly providers?: ReadonlyArray<WebSearchProvider>;
};

export type WebSearchResultRow = {
  readonly title: string;
  readonly url: string;
  readonly content: string;
};

export type WebSearchHandlerResult = {
  readonly query: string;
  readonly maxResults: number;
  readonly provider: WebSearchProvider;
  readonly results: ReadonlyArray<WebSearchResultRow>;
};

const clampMaxResults = (n: number): number =>
  Math.min(10, Math.max(1, Number.isFinite(n) ? Math.floor(n) : 5));

/** Replace every secret value in `text` so keys never reach results, errors or traces. */
function scrubSecrets(text: string, secrets: ReadonlyArray<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

function formatProviderAttemptError(
  providerLabel: string,
  e: unknown,
  secrets: ReadonlyArray<string>,
): string {
  const msg = e instanceof Error ? e.message : String(e);
  return scrubSecrets(`${providerLabel}: ${msg}`, secrets);
}

const unwrapKey = (k: string | Redacted.Redacted<string> | undefined): string | undefined => {
  if (k === undefined) return undefined;
  const v = typeof k === "string" ? k : Redacted.value(k);
  return v.length > 0 ? v : undefined;
};

/** Explicit key first, then each env var in order. */
function resolveProviderKey(
  id: WebSearchKeyedProvider,
  config: WebSearchConfig | undefined,
): string | undefined {
  const explicit = unwrapKey(config?.apiKeys?.[id]);
  if (explicit) return explicit;
  const spec = WEB_SEARCH_PROVIDERS.find((p) => p.id === id);
  for (const name of spec?.envVars ?? []) {
    const v = process.env[name];
    if (v) return v;
  }
  return undefined;
}

/** HTTP statuses where the provider refused or overloaded — always try the next backend. */
const LIMIT_OR_TRANSIENT_HTTP = new Set([
  400, 401, 402, 403, 408, 413, 422, 429, 432, 433, 500, 502, 503, 504,
]);

/** Statuses that are transient and worth retrying on the same provider (rate limits, server hiccups). */
const RETRYABLE_HTTP = new Set([429, 408, 500, 502, 503, 504]);

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

async function fetchWithRetry(
  request: () => Promise<Response>,
  maxAttempts = RETRY_MAX_ATTEMPTS,
  baseDelayMs = RETRY_BASE_DELAY_MS,
): Promise<Response> {
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await request();
    if (!RETRYABLE_HTTP.has(response.status)) return response;
    lastResponse = response;
    if (attempt < maxAttempts - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt)));
    }
  }
  return lastResponse!;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _unparsedBody: text.slice(0, 500) };
  }
}

function extractApiErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const o = body as Record<string, unknown>;
  // Tavily: { detail: { error: "..." } } or { detail: "..." }
  const detail = o.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const err = (detail as Record<string, unknown>).error;
    if (typeof err === "string" && err.trim()) return err.trim();
  }
  if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
  if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
  // Brave-style: { type: "ErrorResponse", error: { code, detail } }
  const nested = o.error;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const e = nested as Record<string, unknown>;
    if (typeof e.detail === "string" && e.detail.trim()) return e.detail.trim();
    if (typeof e.message === "string" && e.message.trim()) return e.message.trim();
  }
  return undefined;
}

function formatProviderHttpRejection(
  label: string,
  status: number,
  statusText: string,
  body: unknown,
): string {
  const fromApi = extractApiErrorMessage(body);
  const tail = fromApi ?? (statusText.trim() || undefined);
  const quotaHint = LIMIT_OR_TRANSIENT_HTTP.has(status)
    ? " (trying next search provider)"
    : "";
  const head = `${label.replace(/:+$/, "").trim()}:`;
  const parts = [head];
  if (tail) parts.push(tail);
  parts.push(`[HTTP ${status}]${quotaHint}`);
  return parts.join(" ");
}

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<ReadonlyArray<WebSearchResultRow>> {
  const response = await fetchWithRetry(() =>
    fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_results: maxResults, api_key: apiKey }),
    })
  );

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(formatProviderHttpRejection("Tavily", response.status, response.statusText, body));
  }

  const data = body as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
    detail?: unknown;
    error?: unknown;
  };

  const rows = (data.results ?? [])
    .map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      content: String(r.content ?? ""),
    }))
    .filter((r) => r.url.length > 0);

  if (rows.length === 0) {
    const apiErr = extractApiErrorMessage(body);
    if (apiErr) {
      throw new Error(`Tavily: ${apiErr} (trying next search provider)`);
    }
  }

  return rows;
}

async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<ReadonlyArray<WebSearchResultRow>> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(maxResults));

  const response = await fetchWithRetry(() =>
    fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
    })
  );

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(
      formatProviderHttpRejection("Brave Search", response.status, response.statusText, body),
    );
  }

  const data = body as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  const rows = (data.web?.results ?? [])
    .map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      content: String(r.description ?? ""),
    }))
    .filter((r) => r.url.length > 0);

  if (rows.length === 0) {
    const apiErr = extractApiErrorMessage(body);
    if (apiErr) {
      throw new Error(`Brave Search: ${apiErr} (trying next search provider)`);
    }
  }

  return rows;
}

const KEENABLE_SNIPPET_MAX_CHARS = 500;

async function searchKeenable(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<ReadonlyArray<WebSearchResultRow>> {
  const response = await fetchWithRetry(() =>
    fetch("https://api.keenable.ai/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-Keenable-Title": "reactive-agents",
      },
      body: JSON.stringify({ query, max_results: maxResults }),
    })
  );

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new WebSearchProviderError({
      message: formatProviderHttpRejection("Keenable", response.status, response.statusText, body),
      provider: "Keenable",
      status: response.status,
    });
  }

  const data = body as {
    results?: Array<{ title?: string; url?: string; description?: string; snippet?: string }>;
  };

  return (data.results ?? [])
    .map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      content: String(r.description || (r.snippet ?? "").slice(0, KEENABLE_SNIPPET_MAX_CHARS)),
    }))
    .filter((r) => r.url.length > 0);
}

async function searchSerper(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<ReadonlyArray<WebSearchResultRow>> {
  const response = await fetchWithRetry(() =>
    fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: query, num: maxResults }),
    })
  );

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(formatProviderHttpRejection("Serper", response.status, response.statusText, body));
  }

  const data = body as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  };

  const rows = (data.organic ?? [])
    .map((r) => ({
      title: String(r.title ?? ""),
      url: String(r.link ?? ""),
      content: String(r.snippet ?? ""),
    }))
    .filter((r) => r.url.length > 0);

  if (rows.length === 0) {
    const apiErr = extractApiErrorMessage(body);
    if (apiErr) throw new Error(`Serper: ${apiErr} (trying next search provider)`);
  }

  return rows;
}

type DdgRelatedEntry =
  | { Topics?: readonly DdgRelatedEntry[]; FirstURL?: string; Text?: string }
  | Record<string, unknown>;

function collectDdgRelated(
  entries: readonly DdgRelatedEntry[] | undefined,
  out: WebSearchResultRow[],
  max: number,
): void {
  if (!entries || out.length >= max) return;
  for (const raw of entries) {
    if (out.length >= max) return;
    const e = raw as { Topics?: readonly DdgRelatedEntry[]; FirstURL?: string; Text?: string };
    if (Array.isArray(e.Topics)) {
      collectDdgRelated(e.Topics, out, max);
      continue;
    }
    const url = e.FirstURL;
    const text = e.Text;
    if (typeof url === "string" && url.length > 0 && typeof text === "string" && text.length > 0) {
      const title = text.includes(" - ") ? text.split(" - ")[0]!.trim() : text.trim().slice(0, 120);
      out.push({ title, url, content: text.trim() });
    }
  }
}

/**
 * DuckDuckGo Instant Answer API (no API key). Coverage is limited vs paid search APIs.
 */
async function searchDuckDuckGoInstant(
  query: string,
  maxResults: number,
): Promise<ReadonlyArray<WebSearchResultRow>> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");

  const response = await fetchWithRetry(() =>
    fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } })
  );

  const body = await readJsonBody(response);

  if (!response.ok) {
    throw new Error(
      formatProviderHttpRejection("DuckDuckGo", response.status, response.statusText, body),
    );
  }

  const data = body as {
    Heading?: string;
    AbstractSource?: string;
    AbstractURL?: string;
    AbstractText?: string;
    RelatedTopics?: readonly DdgRelatedEntry[];
    Results?: ReadonlyArray<{ FirstURL?: string; Text?: string }>;
  };

  const out: WebSearchResultRow[] = [];

  if (
    typeof data.AbstractURL === "string" &&
    data.AbstractURL.length > 0 &&
    typeof data.AbstractText === "string" &&
    data.AbstractText.length > 0
  ) {
    const title =
      (typeof data.Heading === "string" && data.Heading.length > 0
        ? data.Heading
        : typeof data.AbstractSource === "string" && data.AbstractSource.length > 0
          ? data.AbstractSource
          : "Summary") ?? "Summary";
    out.push({
      title,
      url: data.AbstractURL,
      content: data.AbstractText.trim(),
    });
  }

  if (Array.isArray(data.Results)) {
    for (const r of data.Results) {
      if (out.length >= maxResults) break;
      const u = r.FirstURL;
      const t = r.Text;
      if (typeof u === "string" && u.length > 0 && typeof t === "string" && t.length > 0) {
        const title = t.includes(" - ") ? t.split(" - ")[0]!.trim() : t.trim().slice(0, 120);
        out.push({ title, url: u, content: t.trim() });
      }
    }
  }

  collectDdgRelated(data.RelatedTopics, out, maxResults);

  return out.slice(0, maxResults);
}

/**
 * Tavily hard-rejects queries over 400 characters (HTTP 400) and the other
 * providers degrade badly on kilobyte queries. An oversize query is always
 * upstream splice noise (e.g. a plan step templating a prior tool result into
 * `query`), so clamp to the tightest provider cap at a word boundary rather
 * than failing the entire provider chain on unsearchable input.
 */
const MAX_QUERY_CHARS = 400;

export function clampQueryLength(query: string): string {
  if (query.length <= MAX_QUERY_CHARS) return query;
  const cut = query.slice(0, MAX_QUERY_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_QUERY_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Operator setup advice for an exhausted provider chain. Developer-facing
 * only: it travels as the failure's `cause` and in a warning log, never in
 * the model-facing message (the model cannot set env vars — truthfulness
 * audit 2026-11-06, row 16).
 */
const WEB_SEARCH_CONFIG_HINT =
  "Optional API keys: TAVILY_API_KEY (Tavily), BRAVE_SEARCH_API_KEY or BRAVE_API_KEY (Brave), SERPER_API_KEY (Serper/Google — 2500 free queries/month), KEENABLE_API_KEY (Keenable). " +
  "If Tavily is over quota, configure Brave or Serper as fallback providers. " +
  "DuckDuckGo instant answers need no key but cover fewer queries.";

/**
 * Model-facing exhaustion message: which providers ran and what each said,
 * plus what the model CAN do next. Setup advice rides in `cause`.
 */
function formatWebSearchFailure(
  query: string,
  attempts: readonly string[],
  keyedProviderConfigured: boolean,
): Error {
  const summary =
    attempts.length > 0 ? attempts.join(" | ") : "No provider returned any rows.";
  const coverage = keyedProviderConfigured
    ? ""
    : "Only DuckDuckGo instant answers are configured; they cover few queries. ";
  return new Error(
    `Web search produced no results for query "${query}". ${summary} ${coverage}` +
      "Try a different query, or for a known URL, use http-get instead.",
    { cause: WEB_SEARCH_CONFIG_HINT },
  );
}

export const webSearchTool: ToolDefinition = {
  name: "web-search",
  description:
    "Search the web and return a list of relevant results. " +
    "Tries each configured search provider in order (Tavily, Brave Search, Serper/Google, Keenable), then DuckDuckGo instant answers, which need no setup. " +
    "If a provider fails or returns no usable rows, the next one runs automatically until one succeeds or all are exhausted. " +
    "Use for current information, facts, prices, news, documentation, or anything requiring up-to-date knowledge. " +
    "Returns an array of results, each with { title, url, content } fields. " +
    "Read the 'content' field of results to extract the information you need.",
  parameters: [
    {
      name: "query",
      type: "string",
      description:
        "The search query. Be specific for better results. " +
        "Examples: 'Bitcoin price today USD', 'TypeScript async await tutorial 2024', 'Node.js fs.readFile docs'.",
      required: true,
    },
    {
      name: "maxResults",
      type: "number",
      description:
        "Maximum number of results to return (1–10). Default: 5. " +
        "Use 3 for quick single-fact lookups, 5 for general research, up to 10 for broad topics.",
      required: false,
      default: 5,
    },
  ],
  returnType:
    "{ query: string, maxResults: number, provider: \"tavily\" | \"brave\" | \"serper\" | \"keenable\" | \"duckduckgo\", results: Array<{ title: string, url: string, content: string }> }",
  category: "search",
  riskLevel: "low",
  /** Tavily + Brave + DuckDuckGo can run sequentially; keep headroom so the chain is not cut off. */
  timeoutMs: 30_000,
  requiresApproval: false,
  mutatesExternalState: false,
  source: "builtin",
  produces: "data",
  // Sprint 3.4 Scaffold 1 — web-search returns N results in one call.
  // Mark as "batch" so the classifier doesn't multiply minCalls based on
  // entity count (e.g. "search 5 currencies" doesn't need 5 separate calls).
  cardinality: "batch",
};

type ChainEntry = {
  readonly label: string;
  readonly emptyMessage: string;
  readonly run: (
    query: string,
    maxResults: number,
    apiKey: string,
  ) => Promise<ReadonlyArray<WebSearchResultRow>>;
};

const CHAIN: Readonly<Record<WebSearchKeyedProvider, ChainEntry>> = {
  tavily: { label: "Tavily", emptyMessage: "Tavily returned no usable rows.", run: searchTavily },
  brave: {
    label: "Brave Search",
    emptyMessage: "Brave Search returned no usable rows.",
    run: searchBrave,
  },
  serper: { label: "Serper", emptyMessage: "Serper returned no usable rows.", run: searchSerper },
  keenable: {
    label: "Keenable",
    emptyMessage: "Keenable returned no usable rows.",
    run: searchKeenable,
  },
};

/**
 * Build a `web-search` handler bound to explicit per-agent keys and an ordered
 * provider list. With no config it behaves exactly like the env-only default.
 * Keys are scrubbed from every error message the handler produces.
 */
export const makeWebSearchHandler =
  (config?: WebSearchConfig) =>
  (
    args: Record<string, unknown>,
  ): Effect.Effect<WebSearchHandlerResult, ToolExecutionError> =>
    Effect.tryPromise({
      try: async (): Promise<WebSearchHandlerResult> => {
        const query = clampQueryLength(args.query as string);
        const maxResults = clampMaxResults((args.maxResults as number) ?? 5);
        const attempts: string[] = [];

        const order = [
          ...new Set(config?.providers ?? WEB_SEARCH_PROVIDERS.map((p) => p.id)),
        ];
        const keys = new Map<WebSearchKeyedProvider, string>();
        for (const spec of WEB_SEARCH_PROVIDERS) {
          if (spec.id === "duckduckgo") continue;
          const k = resolveProviderKey(spec.id, config);
          if (k) keys.set(spec.id, k);
        }
        const secrets = [...keys.values()];
        const tavilyKey = keys.get("tavily");

        for (const id of order) {
          if (id === "duckduckgo") {
            try {
              const results = await searchDuckDuckGoInstant(query, maxResults);
              if (results.length > 0) {
                return { query, maxResults, provider: "duckduckgo", results };
              }
              attempts.push("DuckDuckGo instant answers returned no usable rows.");
            } catch (e) {
              attempts.push(formatProviderAttemptError("DuckDuckGo", e, secrets));
            }
            continue;
          }
          const entry = CHAIN[id];
          const key = keys.get(id);
          if (!key) {
            if (id === "brave" && tavilyKey) {
              attempts.push("Brave Search is not configured as a fallback.");
            }
            continue;
          }
          try {
            const results = await entry.run(query, maxResults, key);
            if (results.length > 0) return { query, maxResults, provider: id, results };
            attempts.push(entry.emptyMessage);
          } catch (e) {
            attempts.push(formatProviderAttemptError(entry.label, e, secrets));
          }
        }

        throw formatWebSearchFailure(
          query,
          attempts,
          order.some((id) => id !== "duckduckgo" && keys.has(id)),
        );
      },
      catch: toToolError("web-search", "Web search"),
    }).pipe(
      // Developer log: provider setup advice the model must not see.
      Effect.tapError(() =>
        Effect.logWarning("web-search-providers-exhausted").pipe(
          Effect.annotateLogs({ configHint: WEB_SEARCH_CONFIG_HINT }),
        ),
      ),
    );

/** Env-only default handler (no explicit keys). */
export const webSearchHandler = makeWebSearchHandler();
