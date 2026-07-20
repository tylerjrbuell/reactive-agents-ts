/**
 * Local Learning + Record Outcome blocks.
 *
 * Owns: LearningEngineService.onRunCompleted() call (calibration/bandit/skill
 * synthesis), procedural memory store of synthesized skill fragments, and the
 * applied-skill outcome record + entropy-improved re-store path.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect, Context } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { Task } from "@reactive-agents/core";
import type { LearningResult } from "@reactive-agents/reactive-intelligence";
import { ProceduralMemoryService } from "@reactive-agents/memory";
import { skillFragmentToProceduralEntry } from "@reactive-agents/reactive-intelligence";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { extractTaskText } from "../util.js";
import { SkillStoreService } from "@reactive-agents/memory";
import { skillFragmentToSkillRecord } from "@reactive-agents/reactive-intelligence";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Full shape of a single entropy log entry (matches execution-engine.ts). */
type EntropyLogEntry = {
  readonly iteration: number;
  readonly composite: number;
  readonly sources: {
    readonly token: number | null;
    readonly structural: number;
    readonly semantic: number | null;
    readonly behavioral: number;
    readonly contextPressure: number;
  };
  readonly trajectory: {
    readonly derivative: number;
    readonly shape: string;
    readonly momentum: number;
  };
  readonly confidence: "high" | "medium" | "low";
};

// ─── Deps interface ───────────────────────────────────────────────────────────

export interface LocalLearningDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly terminatedByRaw: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn" | "llm_error";
  readonly errorsFromLoop: readonly string[];
  readonly entropyLog: readonly EntropyLogEntry[];
  readonly executionDurationMs: number;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const runLocalLearning = (
  deps: LocalLearningDeps,
): Effect.Effect<void, never> => {
  const { ctx, task, config, terminatedByRaw, errorsFromLoop, entropyLog, executionDurationMs } = deps;

  return Effect.gen(function* () {
    // Scoped variable to pass LearningResult from the RI block to the outcome block.
    // ctx.metadata is observable agent context — never use it as a private scratchpad.
    let lastLearningResult: LearningResult | undefined;

    // ── Local Learning: update calibration, bandit, and skill store ──
    if (config.enableReactiveIntelligence && entropyLog.length > 0) {
      yield* Effect.serviceOption(
        Context.GenericTag<{
          onRunCompleted: (data: any) => Effect.Effect<any, never>;
        }>("LearningEngineService"),
      ).pipe(
        Effect.flatMap((opt) => {
          if (opt._tag !== "Some") return Effect.void;
          return Effect.gen(function* () {
            const modelId = String(ctx.selectedModel ?? config.defaultModel ?? "unknown");
            const learningResult = yield* opt.value.onRunCompleted({
              modelId,
              taskDescription: extractTaskText(task.input),
              strategy: ctx.selectedStrategy ?? "reactive",
              outcome: terminatedByRaw === "max_iterations" ? "partial"
                : errorsFromLoop.length > 0 && terminatedByRaw !== "final_answer_tool" && terminatedByRaw !== "final_answer" ? "failure"
                : "success",
              entropyHistory: entropyLog,
              totalTokens: ctx.tokensUsed,
              durationMs: executionDurationMs,
              temperature: (config as { temperature?: number }).temperature ?? 0.7,
              maxIterations: config.maxIterations ?? 10,
              provider: String(ctx.provider ?? config.provider ?? "unknown"),
              skillsActivated: (ctx.metadata.resolvedSkills as ReadonlyArray<{ name?: string; confidence?: string }> | undefined)?.filter((s) => s.confidence === "expert").map((s) => s.name) ?? [],
              convergenceIteration: entropyLog.length > 0
                ? entropyLog.findIndex((e) => e.trajectory?.shape === "converging")
                : null,
              toolCallSequence: (ctx.metadata as { toolCallSequence?: readonly unknown[] }).toolCallSequence ?? [],
            });

            // Pass learning result to the outcome block via a scoped variable.
            lastLearningResult = learningResult;

            // Persist synthesized skill fragment to procedural memory AND skill store
            if (learningResult?.skillSynthesized && learningResult?.skillFragment) {
              const entry = skillFragmentToProceduralEntry({
                fragment: learningResult.skillFragment,
                agentId: config.agentId,
                taskCategory: learningResult.taskCategory,
                modelId,
              });
              yield* Effect.serviceOption(ProceduralMemoryService).pipe(
                Effect.flatMap((svcOpt) => {
                  if (svcOpt._tag !== "Some") return Effect.void;
                  return svcOpt.value.store(entry).pipe(
                    Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:store-skill-fragment", tag: errorTag(err) })),
                  );
                }),
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:service-option-skill-fragment", tag: errorTag(err) })),
              );

              // Dual-store: also persist as SkillRecord to SkillStoreService so
              // SkillResolverService can load it on the next session.
              const skillRecord = skillFragmentToSkillRecord({
                fragment: learningResult.skillFragment,
                agentId: config.agentId,
                taskCategory: learningResult.taskCategory,
                modelId,
              });
              yield* Effect.serviceOption(SkillStoreService).pipe(
                Effect.flatMap((svcOpt) => {
                  if (svcOpt._tag !== "Some") return Effect.void;
                  return svcOpt.value.store(skillRecord).pipe(
                    Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:store-skill-record", tag: errorTag(err) })),
                  );
                }),
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:service-option-skill-record", tag: errorTag(err) })),
              );
            }
          });
        }),
        Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:learning-engine-run-completed", tag: errorTag(err) })),
      );
    }

    // ── Record outcome for applied skill ──
    {
      const appliedSkillId = ctx.metadata.appliedSkillId;
      if (appliedSkillId) {
        const skillOutcome = terminatedByRaw === "max_iterations" ? "partial"
          : errorsFromLoop.length > 0 && terminatedByRaw !== "final_answer_tool" && terminatedByRaw !== "final_answer" ? "failure"
          : "success";

        yield* Effect.serviceOption(ProceduralMemoryService).pipe(
          Effect.flatMap((svcOpt) => {
            if (svcOpt._tag !== "Some") return Effect.void;
            return Effect.gen(function* () {
              // Change 2: record outcome (success rate update)
              yield* svcOpt.value.recordOutcome(appliedSkillId, skillOutcome !== "failure").pipe(
                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:record-outcome", tag: errorTag(err) })),
              );

              // Change 3: re-store improved fragment when entropy improved on a full success
              if (config.enableReactiveIntelligence) {
                const learningResultRef = lastLearningResult;
                const appliedSkillMeanEntropy = ctx.metadata.appliedSkillMeanEntropy;
                if (
                  skillOutcome === "success" &&
                  learningResultRef?.skillSynthesized &&
                  learningResultRef?.skillFragment != null &&
                  typeof appliedSkillMeanEntropy === "number" &&
                  learningResultRef.skillFragment.meanComposite < appliedSkillMeanEntropy
                ) {
                  const modelId = String(ctx.selectedModel ?? config.defaultModel ?? "unknown");
                  const entry = skillFragmentToProceduralEntry({
                    fragment: learningResultRef.skillFragment,
                    agentId: config.agentId,
                    taskCategory: learningResultRef.taskCategory,
                    modelId,
                  });
                  yield* svcOpt.value.store(entry).pipe(
                    Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:re-store-improved-fragment", tag: errorTag(err) })),
                  );
                }
              }
            });
          }),
          Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/local-learning.ts:record-outcome-service-option", tag: errorTag(err) })),
        );
      }
    }
  });
};
