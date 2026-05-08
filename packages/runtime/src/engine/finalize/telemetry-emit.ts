/**
 * Telemetry RunReport emission block.
 *
 * Owns: entropy.composite gauge loop (dashboard), and the
 * TelemetryClientImpl.emitRunReport try/catch block with all enrichment
 * fields — trajectory fingerprint, abstract tools, convergence iteration,
 * peak context pressure, complexity, failure pattern, thought-to-action
 * ratio, entropy variance/oscillation/composite/AUC, classifier accuracy
 * diff, subagent invocations, tool arg validity rate, and local observation
 * persistence.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { Task } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import {
  TelemetryClient as TelemetryClientImpl,
  classifyTaskCategory as classifyTaskCategoryFn,
  lookupModel as lookupModelFn,
  loadObservations,
} from "@reactive-agents/reactive-intelligence";
import {
  buildTrajectoryFingerprint,
  abstractifyToolName,
  firstConvergenceIteration,
  peakContextPressure,
  deriveTaskComplexity,
  deriveFailurePattern,
  deriveThoughtToActionRatio,
  entropyVariance,
  entropyOscillationCount,
  finalCompositeEntropy,
  entropyAreaUnderCurve,
} from "../../telemetry-enrichment.js";
import {
  persistRunObservation,
  buildRunObservation,
  countParallelTurnsFromLog,
} from "../../observers/run-observer.js";
import { diffClassifierAccuracy } from "../../classifier-accuracy.js";
import { isSubagentCall } from "../../subagent-telemetry.js";
import { computeArgValidityRate } from "../../arg-validity.js";
import { extractTaskText } from "../util.js";

// ─── Narrow service types (mirrors execution-engine.ts) ───

type ObsLike = {
  setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** Full shape of a single entropy log entry (matches the declaration in execution-engine.ts). */
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

/** Shape of the reasoning result stored in ctx.metadata.reasoningResult. */
type RrLike =
  | {
      output?: unknown;
      status?: string;
      metadata?: {
        confidence?: number;
        strategyFallback?: boolean;
        terminatedBy?: string;
        finalAnswerCapture?: unknown;
        llmCalls?: number;
      };
    }
  | undefined;

/** Single entry in the tool-call log collected by the ToolCallCompleted listener. */
type ToolCallEntry = {
  readonly toolName: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly iteration: number;
};

export interface TelemetryEmitDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly obs: ObsLike | null;
  readonly rr: RrLike;
  readonly terminatedByRaw: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn" | "llm_error";
  readonly errorsFromLoop: readonly string[];
  readonly executionDurationMs: number;
  readonly entropyLog: readonly EntropyLogEntry[];
  readonly toolCallLog: readonly ToolCallEntry[];
  readonly effectiveRequiredTools: readonly string[] | undefined;
  readonly dialectObserved: "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";
}

// ─── Main export ──────────────────────────────────────────────────────────────

export const emitTelemetryRunReport = (
  deps: TelemetryEmitDeps,
): Effect.Effect<void, never> => {
  const {
    ctx,
    task,
    config,
    obs,
    rr,
    terminatedByRaw,
    errorsFromLoop,
    executionDurationMs,
    entropyLog,
    toolCallLog,
    effectiveRequiredTools,
    dialectObserved,
  } = deps;

  return Effect.gen(function* () {
    // ── Record entropy metrics for dashboard ──
    if (obs && entropyLog.length > 0) {
      for (const pt of entropyLog) {
        yield* obs.setGauge("entropy.composite", pt.composite, {
          taskId: ctx.taskId,
          iteration: String(pt.iteration),
          shape: pt.trajectory.shape,
          confidence: pt.confidence,
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/finalize/telemetry-emit.ts:entropy-composite-gauge", tag: errorTag(err) })));
      }
    }

    // ── Telemetry: build RunReport and fire-and-forget ──
    if (config.enableReactiveIntelligence && entropyLog.length > 0) {
      try {
        const riOpts = config.reactiveIntelligenceOptions as Record<string, unknown> | undefined;
        const telemetryCfg = riOpts?.telemetry;
        const telemetryEnabled = telemetryCfg === undefined || telemetryCfg === true ||
          (typeof telemetryCfg === "object" && telemetryCfg !== null && (telemetryCfg as any).enabled !== false);

        if (telemetryEnabled) {
          const endpoint = typeof telemetryCfg === "object" && telemetryCfg !== null
            ? (telemetryCfg as any).endpoint : undefined;
          const client = new TelemetryClientImpl(endpoint);

          const modelId = String(ctx.selectedModel ?? config.defaultModel ?? "unknown");
          const modelEntry = lookupModelFn(modelId, undefined, String(config.provider ?? ""));
          const taskText = extractTaskText(task.input);
          const toolsUsed = [...new Set(toolCallLog.map(t => t.toolName))];
          const strategySwitched = !!(rr?.metadata as any)?.strategyFallback;

          const outcome: "success" | "partial" | "failure" =
            terminatedByRaw === "max_iterations" ? "partial"
            : errorsFromLoop.length > 0 && terminatedByRaw !== "final_answer_tool" && terminatedByRaw !== "final_answer" ? "failure"
            : "success";

          // ── Enrichment fields (see telemetry-enrichment.ts for logic + tests) ──
          const trajectoryFingerprint = buildTrajectoryFingerprint(entropyLog);
          const abstractToolPattern = toolsUsed.map(abstractifyToolName);
          const iterationsToFirstConvergence = firstConvergenceIteration(entropyLog);
          const contextPressurePeak = peakContextPressure(entropyLog);

          // Skills: use autoActivateSkills (actually injected at bootstrap), not resolvedSkills (full catalog)
          const activeSkills = ((ctx.metadata as any)?.autoActivateSkills ?? []) as Array<{ source: string }>;
          const skillsActiveCount = activeSkills.length;
          const learnedSkillsContribution = activeSkills.some(s => s.source === "learned");

          // ctx.iteration starts at 1 and increments AFTER each loop, so N real iterations = ctx.iteration - 1
          const realIterations = ctx.iteration - 1;
          const taskComplexity = deriveTaskComplexity(realIterations, toolCallLog.length, strategySwitched, contextPressurePeak);
          const failurePattern = deriveFailurePattern(outcome, terminatedByRaw, errorsFromLoop, contextPressurePeak);

          const reasoningStepsForTelemetry = ((ctx.metadata as any)?.reasoningSteps ?? []) as Array<{ type: string }>;
          const thoughtToActionRatio = deriveThoughtToActionRatio(reasoningStepsForTelemetry, toolCallLog.length);

          const classifierAcc = diffClassifierAccuracy(
            effectiveRequiredTools ?? [],
            toolCallLog.map((e) => e.toolName),
          );

          // Derive subagent invocations from toolCallLog.
          // Custom agent tool names come from the builder's agentTools config.
          const customAgentToolNames = (config as any).agentToolNames ?? [];
          const subagentInvocations = toolCallLog
            .filter((e) => isSubagentCall(e.toolName, customAgentToolNames))
            .map((e) => ({ delegated: true, succeeded: e.success }));

          // ToolCallCompleted events don't carry arguments — emit 1.0 as safe default.
          // TODO: pipe arguments through ToolCallCompleted event to enable real scoring.
          const toolArgValidityRate = computeArgValidityRate(
            toolCallLog.map((e) => ({
              toolName: e.toolName,
              arguments: (e as any).arguments ?? {},
            })),
          );

          client.send({
            id: ctx.taskId,
            installId: client.getInstallId(),
            modelId,
            modelTier: modelEntry.tier,
            provider: String(config.provider ?? "unknown"),
            taskCategory: classifyTaskCategoryFn(taskText),
            toolCount: toolCallLog.length,
            toolsUsed,
            strategyUsed: ctx.selectedStrategy ?? "reactive",
            strategySwitched,
            entropyTrace: entropyLog,
            terminatedBy: terminatedByRaw,
            outcome,
            totalIterations: ctx.iteration,
            totalTokens: ctx.tokensUsed,
            durationMs: executionDurationMs,
            clientVersion: "0.8.0",
            trajectoryFingerprint,
            abstractToolPattern,
            iterationsToFirstConvergence,
            contextPressurePeak,
            skillsActiveCount,
            learnedSkillsContribution,
            taskComplexity,
            failurePattern,
            thoughtToActionRatio,
            // Enhanced entropy features (Task 11)
            entropyVariance: entropyVariance(entropyLog),
            entropyOscillationCount: entropyOscillationCount(entropyLog),
            finalCompositeEntropy: finalCompositeEntropy(entropyLog),
            entropyAreaUnderCurve: entropyAreaUnderCurve(entropyLog),
            // Parallel turn count — uses real kernel iteration from ToolCallCompleted events
            parallelTurnCount: countParallelTurnsFromLog(
              toolCallLog.map((t) => ({
                turn: t.iteration,
                toolName: t.toolName,
              })),
            ),
            // Classifier accuracy diff (Task 14)
            classifierFalsePositives: classifierAcc.falsePositives,
            classifierFalseNegatives: classifierAcc.falseNegatives,
            // Subagent invocation outcomes (Task 15)
            subagentInvocations,
            // Tool argument validity rate (Task 16)
            toolArgValidityRate,
            // Resolver dialect tier (Task 13)
            toolCallDialectObserved: dialectObserved,
          });

          // After client.send({...}) completes, persist a local observation (best-effort, never blocks).
          try {
            const observation = buildRunObservation({
              modelId,
              toolCallLog: toolCallLog.map((t) => ({
                turn: t.iteration,
                toolName: t.toolName,
              })),
              totalTurns: ctx.iteration,
              dialect: dialectObserved,
              classifierRequired: effectiveRequiredTools ?? [],
              classifierActuallyCalled: toolsUsed,
              subagentInvoked: subagentInvocations.length,
              subagentSucceeded: subagentInvocations.filter((x) => x.succeeded).length,
              argValidityRate: toolArgValidityRate,
            });
            persistRunObservation(modelId, observation, {
              baseDir: process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"],
            });
          } catch {
            // Observer failure must not affect the run
          }
        }
      } catch {
        // Telemetry must never affect agent — silent failure
      }
    }
  });
};
