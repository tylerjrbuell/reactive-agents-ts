/**
 * Ollama thinking seam: capability check, `think` param resolution and the
 * thinking-aware num_predict budget for the local (Ollama) provider.
 *
 * Moved verbatim out of `providers/local.ts` (2026-11-06), plus the
 * structured-output policy (`resolveStructuredThinking`).
 */
import { Effect } from 'effect'
import type { Capability } from '../capability.js'
import { resolveThinkingEnabled } from '../thinking/index.js'

// ─── Thinking Auto-Detect ───

/**
 * Fallback cache for model thinking-capability checks (avoids repeated
 * /api/show calls).
 *
 * Wave 2a: absorbed onto the capability-probe path — when callers have a
 * resolved `Capability` (probe / static-table / store-backed), that record's
 * `supportsThinkingMode` answers the question and this Map is skipped. The
 * Map remains only for legacy call sites without a capability in scope.
 */
const thinkingCapabilityCache = new Map<string, boolean>()

/**
 * Check if an Ollama model supports thinking mode.
 *
 * Preferred path (Wave 2a): when a resolved `capability` is supplied, read
 * `supportsThinkingMode` off it — that value came from the store-backed
 * /api/show probe (`capabilities` array), so one probe serves size, thinking,
 * and template-emission claims instead of three separate caches.
 *
 * Fallback path: bare /api/show via the SDK client. Uses the canonical
 * `capabilities` array which Ollama populates from the model card. The
 * previous template-string heuristic (checking for the word "think")
 * false-positived on models that mention "think" generically in their chat
 * template — granite3.3 is the smoking-gun case: the template contains
 * "think" but the model lacks the thinking capability, and sending
 * `think: true` causes "does not support thinking" errors that abort the
 * whole agent run.
 */
/** Ollama client slice the thinking probe reads (`/api/show`). */
export type OllamaShowClient = { show: (opts: { model: string }) => Promise<{ capabilities?: readonly string[] | null }> }
async function supportsThinking(
    client: OllamaShowClient,
    model: string,
    capability?: Capability
): Promise<boolean> {
    // A resolver FALLBACK carries no measured facts (supportsThinkingMode is
    // its schema default) — it must not short-circuit the probe fallback.
    if (capability && capability.source !== 'fallback') {
        return capability.supportsThinkingMode
    }

    const cached = thinkingCapabilityCache.get(model)
    if (cached !== undefined) return cached

    try {
        const info = await client.show({ model })
        const capabilities = info.capabilities ?? []
        const result = capabilities.includes('thinking')
        thinkingCapabilityCache.set(model, result)
        return result
    } catch {
        thinkingCapabilityCache.set(model, false)
        return false
    }
}

/**
 * Resolve the `think` parameter for Ollama chat calls.
 *
 * Tri-state return contract (`boolean | undefined`):
 *   - true      → pass `think: true` (explicit opt-in, capable models only)
 *   - false     → pass `think: false` — the user's off-switch. Ollama runs
 *     thinking SERVER-SIDE when the param is absent (bonsai-2, qwen3 family),
 *     so omitting it on `config.thinking === false` never turned thinking off
 *     (introspective-harness probe, 2026-10-24). Verified on Ollama 0.40.6:
 *     `think: false` suppresses thinking (thinking_len=0).
 *   - undefined → omit the `think` param entirely: keeps the provider's
 *     server-side default (config unset) — or, for a non-capable model asked
 *     to go off, there is nothing to switch off (and `think: true` on such
 *     models errors, see supportsThinking).
 *
 * The `true` arm delegates to the shared `resolveThinkingEnabled` resolver so
 * all providers keep one opt-in + warn-once decision contract. The
 * Ollama-specific `/api/show` capability probe is the capability source.
 *
 * @internal exported for unit testing only.
 */
export async function resolveThinking(
    client: OllamaShowClient,
    model: string,
    configThinking: boolean | undefined,
    capability?: Capability
): Promise<boolean | undefined> {
    // Unset → omit: provider/server-side default stays in force (and the
    // widening in widenNumPredictForThinking compensates for it). No probe
    // needed — the answer does not depend on capability.
    if (configThinking === undefined) return undefined
    const capable = await supportsThinking(client, model, capability)
    // Explicit false + capable → think:false (suppress server-side thinking).
    // Explicit false + non-capable → omit (no off-switch needed; never send a
    // think param the model has no thinking mode for).
    if (configThinking === false) return capable ? false : undefined
    // Shared resolver applies the identical opt-in + warn-once discipline.
    return resolveThinkingEnabled('ollama', model, true, capable) ? true : undefined
}

// ─── Thinking-Aware Output Budget ───

/**
 * Extra num_predict headroom for thinking models (B2/P1, 2026-07-07).
 *
 * Ollama counts thinking tokens against num_predict, and thinking-capable
 * models (qwen3 family) think BY DEFAULT even when the `think` param is
 * omitted. A flat caller budget (2048–4096 across kernel/strategy call sites)
 * is routinely consumed entirely inside <think>, yielding an empty-content
 * `done_reason: length` turn that the caller retries with the same dead
 * budget — the qwen3:14b bench measured 54 such exchanges (113k wasted output
 * tokens, 37 min). num_predict is a cap, not a target: widening costs nothing
 * on non-rambling turns and un-starves the visible answer on thinking turns.
 *
 * @internal exported for unit testing only.
 */
export const THINKING_NUM_PREDICT_ALLOWANCE = 6000

/**
 * Widen a resolved num_predict when thinking will consume part of it: either
 * thinking was explicitly enabled (`think === true`), or the param is omitted
 * and the model's capability says it runs a thinking mode by default.
 *
 * @internal exported for unit testing only.
 */
export function widenNumPredictForThinking(
    numPredict: number | undefined,
    think: boolean | undefined,
    capability: { readonly supportsThinkingMode?: boolean },
): number | undefined {
    if (numPredict === undefined) return undefined
    const thinkingActive =
        think === true ||
        (think === undefined && capability.supportsThinkingMode === true)
    return thinkingActive
        ? numPredict + THINKING_NUM_PREDICT_ALLOWANCE
        : numPredict
}

// ─── Structured Output Policy ───

/**
 * Resolve `think` for schema-constrained (`completeStructured`) calls:
 * thinking defaults OFF. An unset preference resolves as an explicit `false`
 * (capable models get `think: false`; non-capable models omit the param), so
 * `widenNumPredictForThinking` adds no allowance and num_predict is the
 * caller's maxTokens. Explicit `true` (request or config) is honored exactly
 * like complete(), allowance included.
 *
 * Why: under `format` the answer is a small JSON object, yet qwen3:4b planner
 * calls thought up to 13,855 tokens against the widened cap (H3 thinking-cap
 * recheck, 2026-11-06). Cloud structured paths already reserve thinking only
 * on explicit opt-in; this brings Ollama to parity. Turning thinking off
 * (rather than capping a thinking call) keeps the A2 fix: a flat cap with
 * thinking still on starves the JSON inside <think>.
 *
 * @param want — `request.thinking ?? config.thinking`
 */
export const resolveStructuredThinking = (
    client: OllamaShowClient,
    model: string,
    want: boolean | undefined,
    capability?: Capability
): Promise<boolean | undefined> =>
    resolveThinking(client, model, want ?? false, capability)

/**
 * Activation key for the structured default: a debug log
 * `structured-thinking-suppressed` (annotations: event, provider, model,
 * numPredict) when an unset preference sent `think: false`. Silent when the
 * caller chose explicitly or the model has no thinking mode.
 */
export const logStructuredThinkingSuppressed = (
    model: string,
    want: boolean | undefined,
    think: boolean | undefined,
    numPredict: number | undefined
): Effect.Effect<void> =>
    want === undefined && think === false
        ? Effect.logDebug('structured-thinking-suppressed').pipe(
              Effect.annotateLogs({
                  event: 'structured-thinking-suppressed',
                  provider: 'ollama',
                  model,
                  numPredict: String(numPredict),
              })
          )
        : Effect.void
