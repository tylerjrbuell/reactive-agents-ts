// File: src/kernel/capabilities/verify/critique.ts
/**
 * Shared critique pass — LLM-as-judge primitive for multi-pass strategies.
 *
 * Canonical home for "ask an LLM to evaluate output quality and return a
 * critique string." Both reflexion (self-critique) and plan-execute-reflect
 * (post-execution reflection) route through here.
 *
 * Why this lives in kernel/capabilities/verify/:
 *   - Critique is a verification capability, not strategy-specific control flow.
 *   - The shape (system prompt + body prompt → LLM call → thinking-safe extract
 *     → tokens/cost) is identical across consumers; only the prompts differ.
 *   - Thinking-safe extraction standardized via `extractThinkingSafeContent` so
 *     no consumer has to re-implement the 4-layer fallback chain. Strict upgrade
 *     for any caller previously using bare `stripThinking`.
 *
 * Strategy-specific concerns kept in the caller:
 *   - System prompt resolution (Effect prompt service, fallbacks)
 *   - Prompt body construction (different signatures per strategy)
 *   - Emit_log + step push (different event tags / observation formats)
 *   - Satisfaction / stagnation checks downstream of the returned critique
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { gatewayComplete } from "../../llm-gateway.js";
import {
  extractThinkingSafeContent,
  THINKING_SAFE_MIN_TOKENS,
} from "../../utils/stream-parser.js";
import { withEnvContext } from "../../../context/context-engine.js";

/** Depth dial for critique passes. "deep" raises the token budget for richer
 *  reasoning; "shallow" stays at the thinking-safe minimum. */
export type CritiqueDepth = "shallow" | "deep";

/** Result of a critique pass — usable content + telemetry. */
export interface CritiqueResult {
  /** Thinking-safe extracted critique text (never null; "" if every fallback empty). */
  readonly content: string;
  /** True if any stripping or fallback was applied to produce `content`. */
  readonly recovered: boolean;
  /** Raw thinking trace if available (in-band <think> or provider-separated). */
  readonly thinking: string | null;
  readonly tokens: number;
  readonly cost: number;
  /**
   * Present ONLY when the critique LLM call failed and the pass degraded to an
   * empty (no-op) critique instead of aborting the run. Callers should treat a
   * degraded result as "no critique this round" and surface the reason so the
   * skip is traceable, not silent. Absent on every successful pass.
   */
  readonly degraded?: { readonly reason: string };
}

/** Inputs for `runCritiquePass`. Caller resolves system + body prompts. */
export interface RunCritiquePassInput {
  readonly llm: LLMService["Type"];
  /** Fully-resolved system prompt (after any prompt-service compilation). */
  readonly systemPrompt: string;
  /** Strategy-specific prompt body (e.g. buildCritiquePrompt, buildReflectionPrompt). */
  readonly promptBody: string;
  /** Depth dial — controls maxTokens cap. */
  readonly depth: CritiqueDepth;
  /** Strategy name for ExecutionError attribution on LLM failure. */
  readonly strategyName: string;
  /** Step / iteration counter for ExecutionError attribution. */
  readonly step: number;
  /**
   * Run correlation snapshot threaded into the LLM request so the observable-llm
   * chokepoint can key its trace + ContextPressure emission to the real run
   * instead of the 'llm-direct' placeholder. Callers (plan-execute, reflexion)
   * pass their parent taskId/iteration. Optional — back-compat for any caller
   * that doesn't correlate.
   */
  readonly traceContext?: { readonly taskId?: string; readonly iteration?: number };
}

/** Token cap derivation: matches the cap previously hard-coded in both consumers. */
export function critiqueMaxTokens(depth: CritiqueDepth): number {
  return depth === "deep" ? 2500 : THINKING_SAFE_MIN_TOKENS;
}

/**
 * Run one LLM critique pass.
 *
 * - Always uses temperature 0.3 (objective judgment, both consumers' prior
 *   behavior; centralized here to prevent drift).
 * - Wraps system prompt via `withEnvContext` for consistent env-aware delivery.
 * - Extracts content via `extractThinkingSafeContent` — the 4-layer fallback
 *   that rescues answers trapped inside `<think>` blocks or provider-separated
 *   thinking fields.
 * - GRACEFUL DEGRADATION: a critique is an ENHANCEMENT, not a gate. A failed
 *   critique LLM call (transient overload / rate-limit / timeout) must NOT abort
 *   a run that already produced an answer — it degrades to a `degraded` empty
 *   result so the caller proceeds with its current answer. This pass therefore
 *   never fails (`E = never`); the prior behaviour mapped any LLM error to an
 *   `ExecutionError` that killed the whole run on a provider blip (Wave 5
 *   root-cause: a transient critique failure zeroed real work).
 */
export function runCritiquePass(
  input: RunCritiquePassInput,
): Effect.Effect<CritiqueResult, never, never> {
  return gatewayComplete(input.llm, {
    purpose: "verify",
    // Depth-derived cap predates the gateway's class table; keep it exact.
    budgetTokens: critiqueMaxTokens(input.depth),
  }, {
      messages: [{ role: "user", content: input.promptBody }],
      systemPrompt: withEnvContext(input.systemPrompt),
      temperature: 0.3,
      ...(input.traceContext ? { traceContext: input.traceContext } : {}),
    })
    .pipe(
      Effect.map((response): CritiqueResult => {
        const safe = extractThinkingSafeContent(response);
        return {
          content: safe.content,
          recovered: safe.recovered,
          thinking: safe.thinking,
          tokens: response.usage.totalTokens,
          cost: response.usage.estimatedCost,
        };
      }),
      Effect.catchAll((err) =>
        Effect.succeed<CritiqueResult>({
          content: "",
          recovered: false,
          thinking: null,
          tokens: 0,
          cost: 0,
          degraded: {
            reason: `${input.strategyName} critique failed at step ${input.step}: ${
              (err as { message?: string }).message ?? String(err)
            }`,
          },
        }),
      ),
    );
}
