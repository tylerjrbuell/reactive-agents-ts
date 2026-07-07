// packages/llm-provider/src/params/cloud-timeout.ts
//
// F4 (architecture sweep 2026-07-07, 03-provider-model-params) — the four
// cloud providers hardcoded `Effect.timeout("120 seconds")` AND restated
// `timeoutMs: 120_000` inside the timeout error, twice per provider (8 sites
// total), with no request- or config-level override and two literals free to
// drift. Local already had a real precedence chain (`resolveLocalTimeoutMs`,
// providers/local.ts); this is the cloud analogue.

/**
 * Default per-call ceiling (ms) for a single hosted-provider generation.
 *
 * 120s (G2): 30s was too tight for thinking/reasoning models whose
 * complete() calls (e.g. strategy expansions) routinely exceed 30s.
 */
export const DEFAULT_CLOUD_TIMEOUT_MS = 120_000;

/**
 * Resolve the per-call timeout (ms) for a cloud provider by precedence:
 * per-request override → provider config → thinking-tolerant default.
 *
 *   request.timeoutMs     — caller-supplied per-call override
 *   config.cloudTimeoutMs — provider-wide override (LLM_CLOUD_TIMEOUT_MS env)
 *   DEFAULT_CLOUD_TIMEOUT_MS — 120s default ceiling
 *
 * Constraint enforced: the `Effect.timeout` value and the `timeoutMs`
 * restated in the `LLMTimeoutError` must come from ONE resolved binding per
 * call so the two can never drift again.
 */
export function resolveCloudTimeoutMs(
  request: { readonly timeoutMs?: number },
  config: { readonly cloudTimeoutMs?: number },
): number {
  return request.timeoutMs ?? config.cloudTimeoutMs ?? DEFAULT_CLOUD_TIMEOUT_MS;
}
