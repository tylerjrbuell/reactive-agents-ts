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
import {
  extractThinkingSafeContent,
  THINKING_SAFE_MIN_TOKENS,
} from "../reason/stream-parser.js";
import { withEnvContext } from "../../../context/context-engine.js";
import { ExecutionError } from "../../../errors/errors.js";

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
 * - Maps any LLM failure to a strategy-attributed `ExecutionError`.
 */
export function runCritiquePass(
  input: RunCritiquePassInput,
): Effect.Effect<CritiqueResult, ExecutionError, never> {
  return input.llm
    .complete({
      messages: [{ role: "user", content: input.promptBody }],
      systemPrompt: withEnvContext(input.systemPrompt),
      maxTokens: critiqueMaxTokens(input.depth),
      temperature: 0.3,
    })
    .pipe(
      Effect.mapError(
        (err) =>
          new ExecutionError({
            strategy: input.strategyName,
            message: `Critique pass failed at step ${input.step}`,
            step: input.step,
            cause: err,
          }),
      ),
      Effect.map((response) => {
        const safe = extractThinkingSafeContent(response);
        return {
          content: safe.content,
          recovered: safe.recovered,
          thinking: safe.thinking,
          tokens: response.usage.totalTokens,
          cost: response.usage.estimatedCost,
        };
      }),
    );
}
