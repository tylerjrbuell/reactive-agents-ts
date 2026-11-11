/**
 * Closed, structurally-readable classification of provider failures.
 *
 * The retry schedule keys on the `_tag`s in `retry.ts`, not on this class;
 * `mapProviderError` picks the `_tag` from the class. Consumers (the harness
 * trace, kernel recovery via {@link recoveryFor}) read it structurally from the error value:
 * `error._tag`, `error.errorClass`, `error.retryable`, `error.status`.
 *
 * Classification is deterministic from (provider, HTTP status, message). Only
 * shapes that are well known are matched by message; everything else falls back
 * to status code alone, then `unknown`. Message fixtures live in
 * `tests/error-class.test.ts`.
 *
 * Shapes matched by message (provider docs / observed API bodies):
 *   - OpenAI / Groq / xAI / LiteLLM: code `context_length_exceeded`, "maximum
 *     context length is N tokens" (https://platform.openai.com/docs/guides/error-codes)
 *   - Anthropic: "prompt is too long: N tokens > M maximum"; 413 `request_too_large`
 *     (https://docs.anthropic.com/en/api/errors)
 *   - Gemini: 400 INVALID_ARGUMENT "input token count (N) exceeds the maximum
 *     number of tokens allowed (M)" (https://ai.google.dev/gemini-api/docs/troubleshooting)
 *   - Groq / OpenAI: "Request too large for model `m` ... on tokens per minute
 *     (TPM|ITPM|OTPM): Limit N, Requested M" (413 or 429) -> `token_rate_exceeded`
 *   - Ollama server-side tool-call parser: "XML syntax error on line 1: ...",
 *     "error parsing tool call: ..."; Groq 400 `tool_use_failed` "Tool call
 *     validation failed: ..." -> `malformed_output`
 *
 * {@link recoveryFor} maps each class to the recovery a caller should take.
 */

/**
 * Closed set of provider-failure classes.
 *
 * - `malformed_output`: the provider rejected the MODEL's own output (its tool-
 *   call parser failed, or the call named a tool not in the request). The input
 *   was fine; sampling is stochastic, so a resample can succeed.
 * - `token_rate_exceeded`: one request's tokens exceed the account's per-minute
 *   token budget (TPM / ITPM input, OTPM output). The request itself is larger
 *   than the budget, so waiting does not help; shrink the input (TPM/ITPM) or
 *   `max_tokens` (OTPM). Distinct from `request_too_large` (a hard body-size
 *   limit) and from `rate_limit` (budget used up by earlier requests).
 */
export type LLMErrorClass =
  | "rate_limit"
  | "token_rate_exceeded"
  | "context_overflow"
  | "request_too_large"
  | "malformed_output"
  | "invalid_param"
  | "tool_schema_invalid"
  | "auth"
  | "model_not_found"
  | "timeout"
  | "network"
  | "provider_5xx"
  | "content_filter"
  | "unknown";

/** Result of {@link classifyProviderError}. */
export interface ProviderErrorClassification {
  readonly errorClass: LLMErrorClass;
  /** Whether re-sending the identical request could plausibly succeed. */
  readonly retryable: boolean;
}

/** Input to {@link classifyProviderError}. */
export interface ProviderErrorFacts {
  readonly providerId: string;
  readonly status?: number;
  /** One-line provider reason (body message). */
  readonly message: string;
  /** Provider error code string, when the SDK exposes one (e.g. `context_length_exceeded`). */
  readonly code?: string;
}

/**
 * Node/undici network faults meaning "the request never reached a verdict".
 * `context canceled` / `aborted` are deliberately EXCLUDED (user-initiated).
 */
export const NETWORK_FAULT =
  /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|EHOSTUNREACH|ECONNABORTED|socket hang up|network error|fetch failed|premature close|unexpected EOF|EOF)\b/i;

const CONTEXT_OVERFLOW =
  /context_length_exceeded|maximum context length|prompt is too long|input token count.*exceeds|exceeds the maximum number of tokens|reduce the length of the messages|context length of \d+/i;
const REQUEST_TOO_LARGE =
  /request_too_large|request exceeds the maximum allowed number of bytes|request (body )?too large|payload too large|entity too large/i;
const AUTH = /authentication|unauthorized|invalid[ _-]?api[ _-]?key|api[ _-]?key.*(missing|not set|invalid)|apiKey or authToken|credential|permission_denied/i;
const MODEL_NOT_FOUND = /model\s+['"]?\S+?['"]?\s+(not found|does not exist)|model_not_found|no such model/i;
const CONTENT_FILTER = /content_filter|content_policy_violation|content management policy|blocked (due to|by) (the )?(safety|content)/i;
const TOOL_SCHEMA =
  /does not support tools|invalid schema for function|invalid[_ ]function[_ ]parameters|input_schema|tools?(\.\d+)?\.[\w.]+:|tool_use ids? (were|was) found without|function (declarations?|parameters?).*(invalid|must)|invalid[ _]tool/i;
const TIMEOUT = /timed? ?out|ETIMEDOUT|deadline exceeded/i;
const QUOTA_EXHAUSTED = /insufficient_quota|exceeded your current quota/i;
/**
 * "Request too large" against a per-minute token budget. "Rate limit reached
 * ... Used N, Requested M" (budget spent by earlier calls) is NOT matched: that
 * one clears with a wait and stays `rate_limit`.
 */
const TOKEN_RATE_EXCEEDED = /request too large for\b.*\b(tokens per min(ute)?|[IO]?TPM)\b/i;
/** Output-side budget (OTPM): the fix is a smaller `max_tokens`, not a smaller prompt. */
export const OUTPUT_TOKEN_RATE = /output tokens per min|\bOTPM\b/i;
/**
 * The provider failed to parse or validate the model's own output. Contains
 * tokens NETWORK_FAULT also matches ("XML syntax error ...: unexpected EOF"),
 * so it MUST be tested before NETWORK_FAULT.
 */
export const MALFORMED_OUTPUT =
  /XML syntax error|error parsing tool call|failed to parse tool call|tool call validation failed|tool_use_failed|failed to call a function/i;

/**
 * Deterministically classify a provider failure.
 * Order matters: a per-minute-budget "request too large" first (it arrives as
 * 413 OR 429), then 429 (other rate limits that mention tokens stay rate
 * limits), overflow/size, auth, not-found, content filter, malformed model
 * output (before the 4xx branch and before network: its messages carry 400 and
 * "unexpected EOF"), tool schema, other 4xx, timeout, network, 5xx.
 */
export function classifyProviderError(f: ProviderErrorFacts): ProviderErrorClassification {
  const { status, message } = f;
  const hay = f.code ? `${f.code} ${message}` : message;
  const is = (errorClass: LLMErrorClass, retryable = false): ProviderErrorClassification => ({
    errorClass,
    retryable,
  });

  if (TOKEN_RATE_EXCEEDED.test(hay)) return is("token_rate_exceeded");
  if (status === 429) return is("rate_limit", !QUOTA_EXHAUSTED.test(hay));
  if (status === 413) return is("request_too_large");
  if (CONTEXT_OVERFLOW.test(hay)) return is("context_overflow");
  if (REQUEST_TOO_LARGE.test(hay)) return is("request_too_large");
  if (status === 401 || status === 403 || AUTH.test(hay)) return is("auth");
  if (status === 404 || MODEL_NOT_FOUND.test(hay)) return is("model_not_found");
  if (CONTENT_FILTER.test(hay)) return is("content_filter");
  if (MALFORMED_OUTPUT.test(hay)) return is("malformed_output", true);
  if (status === 400 || status === 422) {
    return TOOL_SCHEMA.test(hay) ? is("tool_schema_invalid") : is("invalid_param");
  }
  if (status === 408 || TIMEOUT.test(hay)) return is("timeout", true);
  if (NETWORK_FAULT.test(hay)) return is("network", true);
  if (typeof status === "number" && status >= 500) return is("provider_5xx", true);
  return is("unknown");
}

/**
 * Recovery a caller should take for a provider failure:
 * - `resample`: send the same request again; the model's output was at fault.
 * - `shrink`: send a smaller request (compact the prompt; for an OTPM
 *   `token_rate_exceeded`, lower `max_tokens`).
 * - `backoff`: wait, then send the same request (transient provider/network state).
 * - `fatal`: no retry can succeed without a config or code change.
 */
export type LLMRecovery = "resample" | "shrink" | "backoff" | "fatal";

const RECOVERY: Readonly<Record<LLMErrorClass, LLMRecovery>> = {
  rate_limit: "backoff",
  token_rate_exceeded: "shrink",
  context_overflow: "shrink",
  request_too_large: "shrink",
  malformed_output: "resample",
  invalid_param: "fatal",
  tool_schema_invalid: "fatal",
  auth: "fatal",
  model_not_found: "fatal",
  timeout: "backoff",
  network: "backoff",
  provider_5xx: "backoff",
  content_filter: "fatal",
  unknown: "fatal",
};

/**
 * Pure policy: the recovery for a provider-failure class. Pass the
 * classification's `retryable` when known: a non-retryable `backoff`/`resample`
 * class (e.g. a 429 for an exhausted quota) is `fatal`. `shrink` is kept
 * either way, since a smaller request is a different request.
 */
export function recoveryFor(errorClass: LLMErrorClass, retryable?: boolean): LLMRecovery {
  const recovery = RECOVERY[errorClass];
  if (retryable === false && (recovery === "backoff" || recovery === "resample")) return "fatal";
  return recovery;
}

/**
 * Best-effort extraction of (tokenCount, maxTokens) from an overflow message.
 * Returns zeros when the provider did not state them.
 */
export function parseOverflowTokens(message: string): { tokenCount: number; maxTokens: number } {
  const num = (s: string | undefined): number => (s ? Number(s.replace(/,/g, "")) : 0);
  // Anthropic: "prompt is too long: 213462 tokens > 200000 maximum"
  const a = message.match(/(\d[\d,]*)\s*tokens?\s*>\s*(\d[\d,]*)/i);
  if (a) return { tokenCount: num(a[1]), maxTokens: num(a[2]) };
  // OpenAI: "maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens"
  const o = message.match(/maximum context length is (\d[\d,]*).*?resulted in (\d[\d,]*)/i);
  if (o) return { tokenCount: num(o[2]), maxTokens: num(o[1]) };
  // Gemini: "input token count (1100000) exceeds the maximum number of tokens allowed (1048575)"
  const g = message.match(/token count \(?(\d[\d,]*)\)?.*?allowed \(?(\d[\d,]*)\)?/i);
  if (g) return { tokenCount: num(g[1]), maxTokens: num(g[2]) };
  // Groq / OpenAI per-minute budget: "(TPM): Limit 8000, Requested 8122" (maxTokens = the budget)
  const t = message.match(/Limit (\d[\d,]*), Requested (\d[\d,]*)/i);
  if (t) return { tokenCount: num(t[2]), maxTokens: num(t[1]) };
  return { tokenCount: 0, maxTokens: 0 };
}
