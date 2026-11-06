/**
 * Reflection-iteration entropy scoring + reactive-controller dispatch for the
 * plan-execute strategy.
 *
 * Extracted verbatim from the outer refinement loop of `executePlanExecute`.
 * Scores the reflection content as the "thought" of this iteration, publishes
 * `EntropyScored`, lets the reactive controller decide interventions, dispatches
 * them (publishing `InterventionDispatched` / `InterventionSuppressed`), and
 * reports whether an `early-stop` patch fired. All services are optional and
 * every failure degrades to a no-op (never fails the run).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan } from "../../types/plan.js";
import type { PlanExecuteInput } from "../plan-execute.js";

/** One scored reflection iteration, as the reactive controller consumes it. */
export type PEREntropyEntry = {
  readonly composite: number;
  readonly trajectory: { readonly shape: string; readonly derivative: number; readonly momentum: number };
};

/** Per-strategy intervention budget, mutated across refinements so suppression gates trip. */
export interface RiBudget {
  interventionsFiredThisRun: number;
  tokensSpentOnInterventions: number;
}

export interface ReflectionEntropyDeps {
  readonly services: StrategyServices;
  readonly input: Pick<
    PlanExecuteInput,
    "taskId" | "taskDescription" | "modelId" | "temperature" | "availableTools" | "harnessPipeline"
  >;
  readonly steps: readonly ReasoningStep[];
  readonly plan: Plan;
  /** Current refinement index (the iteration label for scoring/events). */
  readonly refinement: number;
  readonly maxRefinements: number;
  readonly totalTokens: number;
  readonly reflectionContent: string;
  readonly entropyHistory: readonly PEREntropyEntry[];
  /** Mutated in place (W3 FIX-23). */
  readonly riBudget: RiBudget;
}

export interface ReflectionEntropyResult {
  /** True when an applied `early-stop` patch asks the loop to break. */
  readonly earlyStop: boolean;
  readonly entropyHistory: readonly PEREntropyEntry[];
}

export const scoreReflectionAndDispatch = (
  deps: ReflectionEntropyDeps,
): Effect.Effect<ReflectionEntropyResult, never> =>
  Effect.gen(function* () {
    const { services, input, steps, plan, refinement, maxRefinements, totalTokens, reflectionContent, riBudget } = deps;
    let perEntropyHistory = deps.entropyHistory;
    let perRIEarlyStop = false;
    if (services.entropySensor._tag === "Some") {
      const syntheticState = {
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        kernelType: "plan-execute",
        steps: steps.map((rs) => ({
          type: rs.type,
          ...(rs.content != null ? { content: rs.content } : {}),
        })),
        toolsUsed: new Set(
          plan.steps
            .filter((ps) => ps.status === "completed" && ps.toolName)
            .map((ps) => ps.toolName!),
        ),
        iteration: refinement,
        tokens: totalTokens,
        status: "observing",
        output: null,
        error: null,
        meta: {} as Record<string, unknown>,
      };

      const scoreResult = yield* services.entropySensor.value
        .score({
          thought: reflectionContent,
          taskDescription: input.taskDescription ?? "",
          strategy: "plan-execute-reflect",
          iteration: refinement,
          maxIterations: maxRefinements,
          modelId: input.modelId ?? "unknown",
          temperature: input.temperature ?? 0,
          kernelState: syntheticState,
        })
        .pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (scoreResult !== null) {
        const entry: PEREntropyEntry = {
          composite: scoreResult.composite,
          trajectory: scoreResult.trajectory,
        };
        perEntropyHistory = [...perEntropyHistory, entry];

        if (services.eventBus._tag === "Some") {
          const richScore = scoreResult as Record<string, unknown>;
          yield* services.eventBus.value.publish({
            _tag: "EntropyScored",
            taskId: input.taskId ?? "plan-execute",
            iteration: refinement,
            composite: scoreResult.composite,
            sources: richScore["sources"],
            trajectory: richScore["trajectory"],
            confidence: richScore["confidence"],
            modelTier: richScore["modelTier"],
            iterationWeight: richScore["iterationWeight"],
            modelId: input.modelId ?? "unknown",
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:659", tag: errorTag(err) })));
        }

        if (services.reactiveController._tag === "Some" && perEntropyHistory.length > 0) {
          const latestScore = scoreResult as Record<string, unknown>;
          const sources = latestScore["sources"] as Record<string, number> | undefined;
          const decisions = yield* services.reactiveController.value
            .evaluate({
              entropyHistory: perEntropyHistory,
              iteration: refinement,
              maxIterations: maxRefinements,
              strategy: "plan-execute-reflect",
              calibration: {
                highEntropyThreshold: 0.8,
                convergenceThreshold: 0.4,
                calibrated: false,
                sampleCount: 0,
              },
              config: { earlyStop: true, strategySwitch: false },
              behavioralLoopScore: sources?.["behavioral"] ?? 0,
            })
            .pipe(Effect.catchAll(() => Effect.succeed([])));

          if (decisions.length > 0 && services.dispatcher._tag === "Some") {
            const dispatchContext = {
              iteration: refinement,
              entropyScore: {
                composite: scoreResult.composite,
                token: 0,
                structural: sources?.["structural"] ?? 0,
                semantic: sources?.["semantic"] ?? 0,
                behavioral: sources?.["behavioral"] ?? 0,
                contextPressure: sources?.["contextPressure"] ?? 0,
              },
              recentDecisions: decisions as readonly { readonly decision: string; readonly reason: string }[],
              budget: {
                interventionsFiredThisRun: riBudget.interventionsFiredThisRun,
                tokensSpentOnInterventions: riBudget.tokensSpentOnInterventions,
              },
              // GH #127 — bridge applied RI decisions into Compose tags on
              // plan-execute's outer refinement loop. No-op when absent.
              harnessPipeline: input.harnessPipeline,
            };
            const dispatchResult = yield* services.dispatcher.value
              .dispatch(decisions as readonly { readonly decision: string; readonly reason: string }[], {}, dispatchContext)
              .pipe(Effect.catchAll(() => Effect.succeed({ appliedPatches: [], skipped: [], totalCost: { tokens: 0, latencyMs: 0 } })));

            // W3 FIX-23: accumulate per-strategy budget so the next refinement
            // iteration's dispatch sees real counts at the suppression gates.
            riBudget.interventionsFiredThisRun += dispatchResult.appliedPatches.length;
            riBudget.tokensSpentOnInterventions += dispatchResult.totalCost.tokens;

            // HS-107: preserve source decisionType for trace analytics.
            // Prior code passed patch.kind for both fields, conflating
            // decisions (early-stop) with patches of another name.
            for (const { decisionType, patch } of dispatchResult.appliedPatches) {
              if (services.eventBus._tag === "Some") {
                yield* services.eventBus.value.publish({
                  _tag: "InterventionDispatched",
                  taskId: input.taskId ?? "plan-execute",
                  iteration: refinement,
                  decisionType,
                  patchKind: patch.kind,
                  cost: { tokensEstimated: dispatchResult.totalCost.tokens, latencyMsEstimated: dispatchResult.totalCost.latencyMs },
                  telemetry: {},
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:713", tag: errorTag(err) })));
              }
              if (patch.kind === "early-stop") perRIEarlyStop = true;
            }

            for (const skipped of dispatchResult.skipped) {
              if (services.eventBus._tag === "Some") {
                yield* services.eventBus.value.publish({
                  _tag: "InterventionSuppressed",
                  taskId: input.taskId ?? "plan-execute",
                  iteration: refinement,
                  decisionType: skipped.decisionType,
                  reason: skipped.reason as
                    | "below-entropy-threshold"
                    | "below-iteration-threshold"
                    | "over-budget"
                    | "max-fires-exceeded"
                    | "mode-advisory"
                    | "mode-off"
                    | "no-handler",
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:733", tag: errorTag(err) })));
              }
            }
          }
        }
      }
    }
    return { earlyStop: perRIEarlyStop, entropyHistory: perEntropyHistory };
  });
