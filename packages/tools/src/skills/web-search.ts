import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

/** Which backend produced the result list (for debugging and traces). */
export type WebSearchProvider = "tavily" | "brave" | "serper" | "duckduckgo";

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

const braveApiKey = (): string | undefined =>
  process.env.BRAVE_SEARCH_API_KEY ?? process.env.BRAVE_API_KEY;

function formatProviderAttemptError(providerLabel: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `${providerLabel}: ${msg}`;
}

/** HTTP statuses where the provider refused or overloaded — always try the next backend. */
const LIMIT_OR_TRANSIENT_HTTP = new Set([
  400, 401, 402, 403, 408, 413, 422, 429, 432, 433, 500, 502, 503, 504,
]);

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
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      api_key: apiKey,
    }),
  });

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

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

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

async function searchSerper(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<ReadonlyArray<WebSearchResultRow>> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
  });

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

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

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

function formatWebSearchFailure(query: string, attempts: readonly string[]): Error {
  const summary =
    attempts.length > 0 ? attempts.join(" | ") : "No provider returned any rows.";
  return new Error(
    `Web search produced no results for query "${query}". ${summary} ` +
      "Optional API keys: TAVILY_API_KEY (Tavily), BRAVE_SEARCH_API_KEY or BRAVE_API_KEY (Brave), SERPER_API_KEY (Serper/Google — 2500 free queries/month). " +
      "If Tavily is over quota, configure Brave or Serper as fallback providers. " +
      "DuckDuckGo instant answers need no key but cover fewer queries. " +
      "For a known URL, use http-get instead.",
  );
}

export const webSearchTool: ToolDefinition = {
  name: "web-search",
  description:
    "Search the web and return a list of relevant results. " +
    "Provider chain: Tavily (if TAVILY_API_KEY is set) → Brave Search (if BRAVE_SEARCH_API_KEY or BRAVE_API_KEY is set) → Serper/Google (if SERPER_API_KEY is set) → DuckDuckGo instant answers (no key). " +
    "If a provider has no key, or its request fails or returns no usable rows, the next provider runs automatically until one succeeds or all are exhausted. " +
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
    "{ query: string, maxResults: number, provider: \"tavily\" | \"brave\" | \"duckduckgo\", results: Array<{ title: string, url: string, content: string }> }",
  category: "search",
  riskLevel: "low",
  /** Tavily + Brave + DuckDuckGo can run sequentially; keep headroom so the chain is not cut off. */
  timeoutMs: 30_000,
  requiresApproval: false,
  source: "builtin",
};

export const webSearchHandler = (
  args: Record<string, unknown>,
): Effect.Effect<WebSearchHandlerResult, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const query = args.query as string;
      const maxResults = clampMaxResults((args.maxResults as number) ?? 5);
      const attempts: string[] = [];

      const tavilyKey = process.env.TAVILY_API_KEY;
      if (tavilyKey) {
        try {
          const results = await searchTavily(query, maxResults, tavilyKey);
          if (results.length > 0) {
            return { query, maxResults, provider: "tavily", results };
          }
          attempts.push("Tavily returned no usable rows.");
        } catch (e) {
          attempts.push(formatProviderAttemptError("Tavily", e));
        }
      }

      const braveKey = braveApiKey();
      if (!braveKey && tavilyKey) {
        attempts.push(
          "Brave Search not configured (set BRAVE_SEARCH_API_KEY or BRAVE_API_KEY for full-web fallback when Tavily fails).",
        );
      }
      if (braveKey) {
        try {
          const results = await searchBrave(query, maxResults, braveKey);
          if (results.length > 0) {
            return { query, maxResults, provider: "brave", results };
          }
          attempts.push("Brave Search returned no usable rows.");
        } catch (e) {
          attempts.push(formatProviderAttemptError("Brave Search", e));
        }
      }

      const serperKey = process.env.SERPER_API_KEY;
      if (serperKey) {
        try {
          const results = await searchSerper(query, maxResults, serperKey);
          if (results.length > 0) {
            return { query, maxResults, provider: "serper", results };
          }
          attempts.push("Serper returned no usable rows.");
        } catch (e) {
          attempts.push(formatProviderAttemptError("Serper", e));
        }
      }

      try {
        const results = await searchDuckDuckGoInstant(query, maxResults);
        if (results.length > 0) {
          return { query, maxResults, provider: "duckduckgo", results };
        }
        attempts.push("DuckDuckGo instant answers returned no usable rows.");
      } catch (e) {
        attempts.push(formatProviderAttemptError("DuckDuckGo", e));
      }

      throw formatWebSearchFailure(query, attempts);
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Web search failed: ${e}`,
        toolName: "web-search",
        cause: e,
      }),
  });
