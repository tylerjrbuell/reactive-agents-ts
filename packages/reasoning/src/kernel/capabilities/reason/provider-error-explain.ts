/**
 * Provider-error explanation — translate raw LLM provider errors into
 * actionable messages with provider context and suggested fixes.
 *
 * Extracted from think.ts (WS-6 Phase 6). Pure string→string formatter with
 * no Effect / state dependency; the sole owner of the raw-error → human-message
 * mapping used by the Reason capability's stream-init and stream-consume error
 * paths.
 */

/**
 * Translate raw provider errors into actionable messages with provider context
 * and suggested fixes. Falls through to the raw message (with context) if no
 * pattern matches, so no debugging information is lost.
 *
 * Common patterns covered (checked in this order):
 * - Connection refused / fetch failed (service down, wrong endpoint)
 * - 5xx server errors (transient provider failures) — checked before auth so
 *   a server-error body containing stray "401"/"403" digits isn't misclassified
 * - 401 / 403 / Unauthorized (bad/missing API key)
 * - 429 / Rate limit
 * - Timeout / AbortError
 */
export function explainProviderError(
  rawMessage: string,
  provider?: string,
  model?: string,
): string {
  const ctx = provider ? ` (${provider}${model ? `:${model}` : ""})` : "";
  const lower = rawMessage.toLowerCase();

  // Connection refused / fetch failed → service not running or unreachable
  if (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("connect timeout") ||
    lower.includes("enotfound") ||
    lower.includes("socket hang up") ||
    lower.includes("network request failed")
  ) {
    if (provider === "ollama") {
      return `Cannot connect to Ollama${ctx}. Is the service running?\n  Start it with: ollama serve\n  Or set OLLAMA_ENDPOINT to a different host.\n  Original error: ${rawMessage}`;
    }
    return `Cannot reach ${provider ?? "LLM provider"}${ctx}. Connection refused or network unreachable.\n  Check network connectivity and provider endpoint.\n  Original error: ${rawMessage}`;
  }

  // 5xx server errors — checked BEFORE auth so a 5xx body that happens to
  // contain a stray "401"/"403" digit sequence isn't misclassified as an auth
  // failure. The connection branch above already eliminated transport failures.
  if (
    /\b5\d\d\b/.test(rawMessage) ||
    lower.includes("internal server error") ||
    lower.includes("service unavailable") ||
    lower.includes("bad gateway") ||
    lower.includes("gateway timeout")
  ) {
    return `${provider ?? "LLM provider"}${ctx} returned a server error.\n  This is likely transient — try again in a moment.\n  Original error: ${rawMessage}`;
  }

  // Auth errors
  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("authentication") ||
    lower.includes("403") ||
    lower.includes("forbidden")
  ) {
    const apiKeyEnvByProvider: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      gemini: "GOOGLE_API_KEY (or GEMINI_API_KEY)",
      google: "GOOGLE_API_KEY (or GEMINI_API_KEY)",
      litellm: "LITELLM_API_KEY (or proxy-specific env vars)",
    };
    const envHint =
      apiKeyEnvByProvider[provider ?? ""] ?? "the appropriate API key env var";
    return `Authentication failed for ${provider ?? "LLM provider"}${ctx}.\n  Verify ${envHint} is set correctly and has not been revoked.\n  Original error: ${rawMessage}`;
  }

  // Rate limit
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota")
  ) {
    return `Rate limit hit for ${provider ?? "LLM provider"}${ctx}.\n  Slow down requests or upgrade your provider tier.\n  Original error: ${rawMessage}`;
  }

  // Timeout / abort
  if (
    lower.includes("aborterror") ||
    lower.includes("operation was aborted") ||
    lower.includes("request timed out") ||
    lower.includes("timeout") ||
    lower.includes("etimedout")
  ) {
    return `Request to ${provider ?? "LLM provider"}${ctx} timed out.\n  Provider may be slow or unreachable. Check network and provider status.\n  Original error: ${rawMessage}`;
  }

  // Generic fallthrough — preserve raw message with provider context
  return `${provider ?? "LLM"} call failed${ctx}: ${rawMessage}`;
}
