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
import { gatewayComplete } from "../../llm-gateway.js";
import { extractThinkingSafeContent } from "../../utils/stream-parser.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { HARNESS_PSEUDO_TOOLS, META_TOOLS } from "../../state/kernel-constants.js";

/**
 * W4.5 — max evidence-bearing observations carried into the handoff (widened
 * from the previous fixed last-5).
 */
const MAX_KEY_OBSERVATIONS = 12;

/**
 * W2d 2.6 — the reliability values at which the DOCUMENTED classifier skip
 * applies (AGENTS.md: "When classifier reliability is 'low', the LLM
 * classifier call is skipped entirely (saves a round-trip)"). Vocabulary
 * mirrors the runtime's tool-relevance gate
 * (`packages/runtime/.../setup/classifier.ts`: "low" AND "skip" bypass).
 * Before this, the reasoning-side strategy evaluator — the classify
 * round-trip that ACTUALLY fires on local arms per the live post-w1 S1
 * traces — never consulted reliability at all.
 */
export const CLASSIFIER_SKIP_RELIABILITIES: readonly string[] = ["low", "skip"];

/** True when the model's classifier reliability mandates skipping the LLM classify round-trip. */
export function shouldSkipClassifierEvaluation(
  classifierReliability: string | undefined,
): boolean {
  return (
    classifierReliability !== undefined &&
    CLASSIFIER_SKIP_RELIABILITIES.includes(classifierReliability)
  );
}

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
 * W4.5 — keyObservations widened from the last 5 observations to the
 * REQUIREMENT-RELEVANT slice: evidence-bearing (successful, non-meta,
 * non-pseudo) observations are preferred, since those are what a successor
 * strategy needs to resume; when none exist it falls back to the recent
 * observations. Capped at MAX_KEY_OBSERVATIONS. Converts the ReadonlySet of
 * toolsUsed into a plain array.
 */
export function buildHandoff(
  state: KernelState,
  task: string,
  previousStrategy: string,
  failureReason: string,
  switchNumber: number,
  requiredTools: readonly string[] = [],
): StrategyHandoff {
  const obsSteps = state.steps.filter((s) => s.type === "observation");
  const evidenceBearing = obsSteps.filter((s) => {
    const r = s.metadata?.observationResult;
    if (r?.success !== true) return false;
    const name = r.toolName;
    return typeof name === "string" && name.length > 0 && !META_TOOLS.has(name) && !HARNESS_PSEUDO_TOOLS.has(name);
  });
  const chosen = evidenceBearing.length > 0 ? evidenceBearing : obsSteps;
  const observations = chosen
    .slice(-MAX_KEY_OBSERVATIONS)
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
  options?: {
    /**
     * W2d 2.6 — `calibration.classifierReliability` threaded from the kernel
     * input at the loop-detector call site. "low"/"skip" ENFORCE the
     * documented classifier bypass: no classify round-trip, deterministic
     * decline verdict, observable via a harness-signal note.
     */
    readonly classifierReliability?: string;
  },
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

  // W2d 2.6 — documented-skip enforcement. When this model's classifier
  // reliability is measured low (or explicitly skipped), the LLM strategy
  // evaluation must NOT run — the AGENTS.md promise ("skipped entirely,
  // saves a round-trip") becomes real at the site that actually fired on
  // local arms. Deterministic decline: the loop detector's existing paths
  // (recovery / deliver / fail tree, iteration budget) keep governing the
  // run; callers wanting a deterministic switch configure
  // `strategySwitching.fallbackStrategy` (the adjacent pre-existing seam).
  if (shouldSkipClassifierEvaluation(options?.classifierReliability)) {
    const skipReason =
      `classifier-skip: classifierReliability=${options?.classifierReliability} — ` +
      `LLM strategy evaluation skipped (documented low-reliability bypass, W2d 2.6)`;
    return Effect.gen(function* () {
      // Observable where rax diagnose looks: the harness-signal channel.
      yield* emitHarnessSignalInjected({
        taskId: state.taskId,
        iteration: state.iteration,
        signalKind: "other",
        origin: "strategy-switch/classifier-skip",
        content: skipReason,
        metadata: { classifierReliability: options?.classifierReliability },
      });
      return {
        shouldSwitch: false,
        recommendedStrategy: "",
        reasoning: skipReason,
      };
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

    const content = yield* gatewayComplete(llm, { purpose: "classify" }, {
        messages: [
          {
            role: "system",
            content:
              "You are a reasoning strategy evaluator. Respond only with valid JSON — no markdown, no prose outside the JSON object.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0,
      })
      .pipe(
        // Apply thinking-safe extraction BEFORE the markdown-fence strip +
        // JSON.parse below so qwen3/DeepSeek-R1 <think> preambles cannot
        // poison the JSON parser.
        Effect.map((r) => extractThinkingSafeContent(r).content),
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
