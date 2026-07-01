import { LLMError, LLMRateLimitError } from "./errors.js";
import type { LLMErrors } from "./errors.js";
import type { LLMProvider } from "./types.js";

/**
 * Shared provider-error normalization.
 *
 * Every provider SDK throws a slightly different error shape, but the failure
 * modes we care about are the same: rate limits, model-not-found (typos), and
 * everything else. Before this module each provider set
 * `message: err.message ?? String(error)` and `cause: error`, which had two
 * live defects (2026-07-01 audit):
 *
 *   1. Duplication + stack leak — `err.message` for a 404 is the full raw JSON
 *      body, so the mapped `message` carried multi-line JSON, and `cause` still
 *      pointed at the raw SDK error object (whose inspection re-prints the same
 *      JSON *and* an internal stack). A model-name typo printed twice with a
 *      stack into internals.
 *   2. No actionable hint for a wrong model id.
 *
 * `mapProviderError` fixes the class:
 *   - `message` is ONE actionable line (JSON body lifted to its inner reason).
 *   - `cause` is a ONE-LINE string, never the raw object — nothing downstream
 *     can re-print the JSON a second time or leak the SDK stack.
 *   - 429 → LLMRateLimitError (honors a `retry-after` header when present).
 *   - 404 / "model not found" → a pull/check-the-id suggestion.
 */

type RawProviderError = {
  readonly status?: number;
  readonly status_code?: number;
  readonly statusCode?: number;
  readonly code?: number;
  readonly message?: string;
  readonly headers?: Record<string, string>;
};

const MAX_REASON_LEN = 300;
const MODEL_NOT_FOUND = /model\s+['"]?(\S+?)['"]?\s+not found/i;

const statusOf = (e: RawProviderError): number | undefined =>
  e.status ?? e.status_code ?? e.statusCode ?? e.code;

/**
 * Collapse a provider SDK error into a single clean line — no stack, no
 * duplicated JSON. SDK messages frequently look like
 * `404 {"type":"error","error":{"message":"..."}}`; we lift the nested
 * `.error.message` / `.message` and keep any leading status token.
 *
 * @internal exported for unit testing.
 */
export function oneLineReason(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : (error as RawProviderError)?.message ?? String(error);

  let reason = raw;
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    const prefix = raw.slice(0, jsonStart).trim();
    try {
      const body = JSON.parse(raw.slice(jsonStart)) as {
        error?: { message?: string };
        message?: string;
      };
      const inner = body.error?.message ?? body.message;
      if (inner) reason = prefix ? `${prefix} ${inner}` : inner;
    } catch {
      // Not JSON after the brace — keep the raw text.
    }
  }

  reason = reason.replace(/\s+/g, " ").trim();
  return reason.length > MAX_REASON_LEN
    ? `${reason.slice(0, MAX_REASON_LEN)}…`
    : reason;
}

/**
 * Normalize any provider SDK error into a clean, tagged LLM error.
 * See module doc for the guarantees.
 */
export function mapProviderError(
  error: unknown,
  provider: LLMProvider,
  model?: string,
): LLMErrors {
  const err = (error ?? {}) as RawProviderError;
  const status = statusOf(err);
  const reason = oneLineReason(error);

  if (status === 429) {
    const retryAfter = err.headers?.["retry-after"];
    return new LLMRateLimitError({
      message: reason || "Rate limit exceeded",
      provider,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : 60_000,
    });
  }

  if (status === 404 || MODEL_NOT_FOUND.test(reason)) {
    const modelName = model ?? reason.match(MODEL_NOT_FOUND)?.[1];
    if (modelName) {
      return new LLMError({
        message:
          provider === "ollama"
            ? `Model "${modelName}" not found locally. Run: ollama pull ${modelName}`
            : `Model "${modelName}" not found on ${provider}. Check the model id and your access.`,
        provider,
        cause: reason,
      });
    }
    // Couldn't determine the model — fall through to the generic clean line
    // rather than emit a "Model \"unknown\"" message.
  }

  return new LLMError({
    message: `${provider} request failed: ${reason}`,
    provider,
    cause: reason,
  });
}
