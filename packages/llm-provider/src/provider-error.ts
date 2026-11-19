import { LLMContextOverflowError, LLMError, LLMMalformedOutputError, LLMRateLimitError } from "./errors.js";
import { NETWORK_FAULT, OUTPUT_TOKEN_RATE, classifyProviderError, parseOverflowTokens } from "./error-class.js";
import type { LLMErrors } from "./errors.js";
import { learnLimitFromProviderError } from "./capability-learned.js";
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

const statusOf = (e: RawProviderError): number | undefined => {
  const s = e.status ?? e.status_code ?? e.statusCode ?? e.code;
  return typeof s === "number" ? s : undefined;
};

/**
 * The env var each cloud provider's layer reads for credentials (verified
 * against `process.env.*` reads in this package). Local/keyless providers
 * (ollama) and bring-your-own-layer ("custom", "test") are absent on purpose —
 * naming an env var for them would be a lie.
 */
const PROVIDER_KEY_ENV: Partial<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  litellm: "LITELLM_API_KEY",
};

/** Credential-shaped failure: 401/403, or an SDK message about keys/auth. */
const AUTH_FAULT =
  /authentication|unauthorized|invalid[ _-]?api[ _-]?key|api[ _-]?key.*(missing|not set|invalid)|apiKey or authToken|credential/i;

/**
 * True when a failure is TRANSIENT — a 5xx (server overload/unavailable, incl.
 * Anthropic/Groq 529) or a network fault. Same remediation as a 429: back off
 * and retry. Kept distinct from permanent 4xx (bad request / auth / not-found),
 * which must fail fast. `retry.ts` retries the LLMRateLimitError class these map
 * to; misclassifying them as the catch-all LLMError (the prior behaviour) meant
 * a single provider blip failed the whole call with no retry.
 */
function isTransientFailure(status: number | undefined, reason: string, raw: RawProviderError): boolean {
  if (typeof status === "number" && status >= 500) return true;
  const codeStr = String((raw as { code?: unknown }).code ?? "");
  return NETWORK_FAULT.test(reason) || NETWORK_FAULT.test(codeStr);
}

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
 * Where an adapter's API key came from. `"config"` = the runtime override
 * `LLMConfig.providerConfig.apiKey` (set by `.withProvider(p, { apiKey })`);
 * `"env"` = the provider's named config field, read from its env var.
 * Drives the credential-failure hint so it names the source actually used.
 */
export type ApiKeySource = "config" | "env";

/**
 * Resolve an adapter's API key: `providerConfig.apiKey` (from
 * `.withProvider(p, { apiKey })`) wins over the provider's env-derived key.
 * One precedence rule for every adapter; returns the source for error hints.
 */
export function resolveProviderApiKey(
  providerConfig: { readonly apiKey?: string } | undefined,
  envKey: string | undefined,
): { readonly apiKey: string | undefined; readonly source: ApiKeySource } {
  return providerConfig?.apiKey !== undefined
    ? { apiKey: providerConfig.apiKey, source: "config" }
    : { apiKey: envKey, source: "env" };
}

/**
 * Normalize any provider SDK error into a clean, tagged LLM error.
 * See module doc for the guarantees. `keySource` (default `"env"`) picks the
 * credential-failure hint: an env var to set, or the `.withProvider` key to check.
 */
export function mapProviderError(
  error: unknown,
  provider: LLMProvider,
  model?: string,
  keySource: ApiKeySource = "env",
): LLMErrors {
  const err = (error ?? {}) as RawProviderError;
  const status = statusOf(err);
  const reason = oneLineReason(error);
  const codeStr = (err as { code?: unknown }).code;
  const cls = classifyProviderError({
    providerId: provider,
    status,
    message: reason,
    code: typeof codeStr === "string" ? codeStr : undefined,
  });
  const meta = { errorClass: cls.errorClass, retryable: cls.retryable, status } as const;
  // A limit the provider stated (window on overflow, output on invalid_param)
  // is written to the model's capability here, the one funnel every adapter's
  // failure passes through, and carried on the error (capability-learned.ts).
  const learned = learnLimitFromProviderError(provider, model, cls.errorClass, reason);
  const learnedLimit = learned !== undefined ? { kind: learned.kind, tokens: learned.tokens } : undefined;
  const withLearned = learnedLimit !== undefined ? { learnedLimit } : {};

  // Output-side per-minute budget (OTPM): the prompt is not the problem, so it
  // must not reach the kernel's compact-the-prompt path. Permanent as sent.
  if (cls.errorClass === "token_rate_exceeded" && OUTPUT_TOKEN_RATE.test(reason)) {
    return new LLMError({ message: `${provider} request failed: ${reason}`, provider, cause: reason, ...meta });
  }

  // Context overflow / request too large / input per-minute budget: typed,
  // permanent as sent (never retried); a smaller request can succeed.
  if (
    cls.errorClass === "context_overflow" ||
    cls.errorClass === "request_too_large" ||
    cls.errorClass === "token_rate_exceeded"
  ) {
    return new LLMContextOverflowError({
      message: `${provider} request failed: ${reason}`,
      ...parseOverflowTokens(reason),
      errorClass: cls.errorClass,
      retryable: false,
      status,
      ...withLearned,
    });
  }

  // Malformed model output (provider's tool-call parser / validator failed):
  // its own tag, retryable, so the schedule resamples (before first stream
  // emission). Checked BEFORE the transient branch: "XML syntax error ...:
  // unexpected EOF" also matches NETWORK_FAULT.
  if (cls.errorClass === "malformed_output") {
    return new LLMMalformedOutputError({ message: reason, provider, status });
  }

  if (status === 429) {
    const retryAfter = err.headers?.["retry-after"];
    return new LLMRateLimitError({
      message: reason || "Rate limit exceeded",
      provider,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : 60_000,
      ...meta,
    });
  }

  // Transient server (5xx incl. 529 overload) / network fault → retryable.
  // Same class the schedule retries as a 429, but the message stays honest
  // about the real cause instead of claiming "rate limit".
  if (isTransientFailure(status, reason, err)) {
    const retryAfter = err.headers?.["retry-after"];
    return new LLMRateLimitError({
      message:
        reason ||
        `${provider} transient failure${typeof status === "number" ? ` (status ${status})` : ""}`,
      provider,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : 1_000,
      ...meta,
    });
  }

  // Credential failure → one actionable line naming the env var to set.
  // First-touch DX: the raw SDK text ("Could not resolve authentication
  // method…") never names ANTHROPIC_API_KEY etc., leaving a new user to
  // search for it. Permanent (never retried). A key passed via
  // `.withProvider(p, { apiKey })` names that source instead — telling the user
  // to set an env var the adapter never read would send them the wrong way.
  if (status === 401 || status === 403 || AUTH_FAULT.test(reason)) {
    const envVar = PROVIDER_KEY_ENV[provider];
    const said = reason ? ` Provider said: ${reason}` : "";
    return new LLMError({
      message:
        keySource === "config"
          ? `${provider} rejected the request credentials. Check the apiKey passed to .withProvider("${provider}", { apiKey }).${said}`
          : envVar
            ? `${provider} rejected the request credentials. Set ${envVar} in your environment (or a .env file) with a valid API key.${said}`
            : `${provider} rejected the request credentials.${said}`,
      provider,
      cause: reason,
      ...meta,
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
        ...meta,
      });
    }
    // Couldn't determine the model — fall through to the generic clean line
    // rather than emit a "Model \"unknown\"" message.
  }

  return new LLMError({
    message: `${provider} request failed: ${reason}`,
    provider,
    cause: reason,
    ...meta,
    ...withLearned,
  });
}
