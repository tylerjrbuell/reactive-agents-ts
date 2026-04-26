/**
 * shared/strategy-evaluator.ts — LLM-backed strategy switch evaluator.
 *
 * When the kernel detects a loop or stall, this module decides whether to
 * switch reasoning strategies. It provides:
 *
 *   - `StrategyHandoff` — context snapshot passed to the new strategy
 *   - `StrategyEvaluation` — evaluator result (shouldSwitch, recommendedStrategy, reasoning)
 *   - `buildHandoff()` — builds a StrategyHandoff from current KernelState
 *   - `evaluateStrategySwitch()` — LLM-backed or short-circuit evaluation
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { KernelState } from "../../../kernel/state/kernel-state.js";
import { getPermanentlyFailedRequiredTools } from "../verify/requirement-state.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Context snapshot passed to the incoming strategy when a switch occurs.
 * Contains the work done so far so the new strategy can resume intelligently.
 */
export interface StrategyHandoff {
  /** The original task description */
  readonly originalTask: string;
  /** Name of the strategy that failed / triggered the switch */
  readonly previousStrategy: string;
  /** Number of reasoning iterations completed before the switch */
  readonly stepsCompleted: number;
  /** All tools called during the previous strategy's execution */
  readonly toolsCalled: readonly string[];
  /** Up to 5 most recent observation step contents */
  readonly keyObservations: readonly string[];
  /** Human-readable reason for the strategy switch */
  readonly failureReason: string;
  /** Monotonically increasing counter — how many times we've switched in this run */
  readonly switchNumber: number;
  /** Required tools that were attempted but never succeeded. The new strategy should
   *  not retry these — they are unavailable. Synthesize without them. */
  readonly permanentlyFailedTools: readonly string[];
}

/**
 * Result of calling `evaluateStrategySwitch()`.
 */
export interface StrategyEvaluation {
  /** Whether the evaluator recommends switching */
  readonly shouldSwitch: boolean;
  /** Name of the recommended strategy (empty string if shouldSwitch is false) */
  readonly recommendedStrategy: string;
  /** Brief explanation from the evaluator */
  readonly reasoning: string;
}

// ── buildHandoff ──────────────────────────────────────────────────────────────

/**
 * Build a StrategyHandoff from the current KernelState.
 *
 * Collects the last 5 observation steps as keyObservations and converts the
 * ReadonlySet<string> toolsUsed into a plain array.
 */
export function buildHandoff(
  state: KernelState,
  task: string,
  previousStrategy: string,
  failureReason: string,
  switchNumber: number,
  requiredTools: readonly string[] = [],
): StrategyHandoff {
  const observations = state.steps
    .filter((s) => s.type === "observation")
    .slice(-5)
    .map((s) => s.content ?? String(s));

  return {
    originalTask: task,
    previousStrategy,
    stepsCompleted: state.iteration,
    toolsCalled: [...state.toolsUsed],
    keyObservations: observations,
    failureReason,
    switchNumber,
    permanentlyFailedTools: getPermanentlyFailedRequiredTools(state.steps, requiredTools),
  };
}

// ── evaluateStrategySwitch ────────────────────────────────────────────────────

/**
 * Decide whether to switch strategies.
 *
 * Short-circuits to `{ shouldSwitch: false }` when no alternatives remain
 * (avoids an unnecessary LLM call). Otherwise makes a single LLM completion
 * call to pick the best alternative strategy.
 *
 * Error handling is intentionally permissive — any LLM / parse error returns
 * `{ shouldSwitch: false }` so the caller can gracefully fall through to
 * standard failure handling.
 */
export function evaluateStrategySwitch(
  state: KernelState,
  task: string,
  availableStrategies: readonly string[],
  triedStrategies: readonly string[],
): Effect.Effect<StrategyEvaluation, never, LLMService> {
  const alternatives = availableStrategies.filter((s) => !triedStrategies.includes(s));

  // Short-circuit: nothing left to try
  if (alternatives.length === 0) {
    return Effect.succeed({
      shouldSwitch: false,
      recommendedStrategy: "",
      reasoning: "No alternative strategies available",
    });
  }

  const observations = state.steps
    .filter((s) => s.type === "observation")
    .slice(-5)
    .map((s) => s.content ?? "")
    .join("\n");

  const prompt = [
    `Task: ${task}`,
    `Current strategy: ${triedStrategies[triedStrategies.length - 1] ?? "unknown"}`,
    `Steps completed: ${state.iteration}`,
    `Failure reason: loop or stall detected`,
    `Recent observations:\n${observations || "(none)"}`,
    `Available alternative strategies: ${alternatives.join(", ")}`,
    ``,
    `Should we switch reasoning strategy? If yes, which one?`,
    `Respond ONLY with valid JSON (no markdown, no explanation outside JSON):`,
    `{"shouldSwitch": true, "recommendedStrategy": "name", "reasoning": "brief explanation"}`,
    `or`,
    `{"shouldSwitch": false, "recommendedStrategy": "", "reasoning": "brief explanation"}`,
  ].join("\n");

  return Effect.gen(function* () {
    const llm = yield* LLMService;

    const content = yield* llm
      .complete({
        messages: [
          {
            role: "system",
            content:
              "You are a reasoning strategy evaluator. Respond only with valid JSON — no markdown, no prose outside the JSON object.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        maxTokens: 256,
      })
      .pipe(
        Effect.map((r) => r.content),
        Effect.catchAll(() =>
          Effect.succeed(
            '{"shouldSwitch":false,"recommendedStrategy":"","reasoning":"LLM error"}',
          ),
        ),
      );

    try {
      const raw = content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      const parsed = JSON.parse(raw) as {
        shouldSwitch?: boolean;
        recommendedStrategy?: string;
        reasoning?: string;
      };
      const recommended = parsed.recommendedStrategy ?? "";
      const validRecommendation = alternatives.includes(recommended);
      return {
        shouldSwitch: !!parsed.shouldSwitch && validRecommendation,
        recommendedStrategy: validRecommendation ? recommended : "",
        reasoning: parsed.reasoning ?? "",
      };
    } catch {
      return {
        shouldSwitch: false,
        recommendedStrategy: "",
        reasoning: "parse error",
      };
    }
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({
        shouldSwitch: false,
        recommendedStrategy: "",
        reasoning: "error",
      }),
    ),
  );
}
