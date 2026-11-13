import { Effect } from "effect";
import { fetchPinned, type PinnedFetchOptions } from "@reactive-agents/runtime-shim";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError, toToolError } from "../errors.js";
import { httpAllowPrivateEnabled } from "../flags.js";

/** Max redirect hops to follow while re-validating each against the egress guard. */
const MAX_REDIRECTS = 5;

/**
 * Hard ceiling on the raw fetched body before it ever reaches JSON parsing or
 * compression. Defense-in-depth: a normal page/API response is orders of
 * magnitude smaller than this (measured live: a full Wikipedia article is
 * ~2.2M chars — already an outlier), but nothing upstream previously bounded
 * `response.text()` / `response.json()` — a pathological multi-MB body would
 * be read and parsed in full before `compressToolResult` (which only runs
 * downstream, in the kernel) ever got a chance to act.
 */
const MAX_BODY_CHARS = 2_000_000;

const CREDENTIAL_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key)$|token|secret|api-?key/i;

/** Headers minus the ones that carry credentials. */
export function withoutCredentialHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !CREDENTIAL_HEADER.test(name)));
}

/**
 * Read a response body as text, stopping once more than `maxChars` have arrived
 * so an oversized body is never held in memory in full. `truncated` is true
 * when the cap cut it off.
 */
export async function readCappedText(
  response: Response,
  maxChars: number,
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > maxChars) {
      await reader.cancel();
      return { text: text.slice(0, maxChars), truncated: true };
    }
  }
  return { text: text + decoder.decode(), truncated: false };
}

export const httpGetTool: ToolDefinition = {
  name: "http-get",
  description:
    "Fetch content from a specific URL via HTTP GET. " +
    "Use when you have an exact URL to retrieve (API endpoint, direct link, web page). " +
    "HTML pages are automatically stripped to plain text so you can read them directly. " +
    "JSON responses are parsed into objects. " +
    "Returns the page text content (status prefix on error). " +
    "For large results, the text is stored automatically — use recall(key, full: true) to retrieve everything. " +
    "Tip: use | transform: to extract a specific field, e.g. http-get(url) | transform: result.slice(0, 2000)",
  parameters: [
    {
      name: "url",
      type: "string",
      description:
        "The full URL to fetch. Must include the scheme (https:// or http://). " +
        "Examples: 'https://api.example.com/v1/data', 'https://jsonplaceholder.typicode.com/posts/1'.",
      required: true,
    },
    {
      name: "headers",
      type: "object",
      description:
        "Optional HTTP headers as a JSON object of key-value string pairs. " +
        "Example: { \"Authorization\": \"Bearer mytoken\", \"Accept\": \"application/json\" }. " +
        "Omit this parameter entirely if no special headers are needed.",
      required: false,
      additionalProperties: { type: "string" },
    },
  ],
  returnType:
    "{ status: number, statusText: string, body: string | object }",
  category: "http",
  riskLevel: "medium",
  timeoutMs: 15_000,
  requiresApproval: false,
  // GET only; SSRF-guarded in the handler (private/loopback hosts refused).
  mutatesExternalState: false,
  source: "builtin",
  produces: "data",
  // Sprint 3.4 Scaffold 1 — http-get fetches ONE URL per call. When a
  // task mentions multiple URLs (the per-entity case), the classifier
  // should multiply minCalls accordingly.
  cardinality: "per-entity",
};

export interface HttpGetConfig {
  readonly allowPrivate?: boolean;
  /**
   * Test seam: injectable DNS resolver and socket transport for the pinned
   * fetch. Production callers leave this unset.
   */
  readonly network?: Pick<PinnedFetchOptions, "resolve" | "transport">;
}

export const httpGetHandler = (
  config?: HttpGetConfig,
): ((args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const url = args.url as string;
      const headers = (args.headers as Record<string, string>) ?? {};

      // Egress guard (F6): the URL is model-controlled. fetchPinned resolves DNS
      // once, validates every answer is public, and connects to that validated
      // address (closing the DNS-rebinding gap). Redirect hops are driven here
      // (redirect: "manual") so each is re-pinned and credentials the model
      // supplied are dropped (broader than fetchPinned's header list) when a hop
      // leaves their origin.
      // Set RA_HTTP_ALLOW_PRIVATE=1 to permit trusted loopback/private targets,
      // or override per-agent via config.
      const guard: PinnedFetchOptions = {
        ...config?.network,
        allowPrivate: config?.allowPrivate ?? httpAllowPrivateEnabled(),
        redirect: "manual",
      };
      let current = url;
      let hopHeaders = headers;
      let response = await fetchPinned(current, { method: "GET", headers: hopHeaders }, guard);
      for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get("location");
        if (!location) break;
        await response.body?.cancel();
        const next = new URL(location, current);
        if (next.origin !== new URL(current).origin) hopHeaders = withoutCredentialHeaders(hopHeaders);
        current = next.toString();
        response = await fetchPinned(current, { method: "GET", headers: hopHeaders }, guard);
      }
      const contentType = response.headers.get("content-type") ?? "";

      // Read as text first (regardless of content-type) so the size cap
      // applies before any JSON parse — `response.json()` on an oversized
      // body would otherwise materialize the whole thing in memory first.
      const { text: boundedText, truncated } = await readCappedText(response, MAX_BODY_CHARS);

      let body: unknown;
      if (truncated) {
        body =
          `[Response body truncated: exceeds the ${MAX_BODY_CHARS}-char ` +
          `safety cap — showing the first ${MAX_BODY_CHARS}]\n${boundedText}`;
      } else if (contentType.includes("application/json")) {
        try {
          body = JSON.parse(boundedText);
        } catch {
          // Content-Type lied or the body was malformed — fall back to raw
          // text rather than failing the whole call.
          body = boundedText;
        }
      } else {
        body = boundedText;
      }

      return {
        status: response.status,
        statusText: response.statusText,
        body,
      };
    },
    catch: toToolError("http-get", "HTTP GET"),
  });
