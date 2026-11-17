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
 * The upload is opt-in (see ../telemetry-gate.ts): with no telemetry setting
 * no TelemetryClient is built (so no install id is created) and nothing is
 * sent. The local run observation is disk-only and is written either way.
 *
 * Lifted from execution-engine.ts post-W23-6a-8 (2358-LOC checkpoint).
 */
import { Effect } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../types.js";
import type { Task, TerminatedBy } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import {
  TelemetryClient as TelemetryClientImpl,
  classifyTaskCategory as classifyTaskCategoryFn,
  lookupModel as lookupModelFn,
  loadObservations,
} from "@reactive-agents/reactive-intelligence";
import { isRunTelemetryEnabled, telemetryEndpoint } from "../telemetry-gate.js";
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
import { extractTaskText, toRiWireOutcome, type RunOutcomeClass } from "../util.js";
import type { ToolCallEntry } from "../execute-event-collectors.js";
import { readActOrAnswerCounts } from "./act-or-answer-read.js";

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
        extensions?: Readonly<Record<string, unknown>>;
      };
    }
  | undefined;


export interface TelemetryEmitDeps {
  readonly ctx: ExecutionContext;
  readonly task: Task;
  readonly config: ReactiveAgentsConfig;
  readonly obs: ObsLike | null;
  readonly rr: RrLike;
  readonly terminatedByRaw: TerminatedBy;
  readonly errorsFromLoop: readonly string[];
  /**
   * The run's outcome class (`PreparedDebrief.runOutcome`): the same verdict
   * the debrief records, runtime vetoes included. Undefined = the run is
   * paused and has not ended, so no RunReport is sent.
   */
  readonly runOutcome: RunOutcomeClass | undefined;
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
    runOutcome,
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
    // A paused run (no outcome yet) sends nothing; the resumed run reports when it ends.
    if (runOutcome !== undefined && config.enableReactiveIntelligence && entropyLog.length > 0) {
      try {
        // Upload is opt-in (../telemetry-gate.ts, owner decision 2026-11-17).
        const telemetryEnabled = isRunTelemetryEnabled(config.reactiveIntelligenceOptions);

        const modelId = String(ctx.selectedModel ?? config.defaultModel ?? "unknown");
        const toolsUsed = [...new Set(toolCallLog.map(t => t.toolName))];

        // Derive subagent invocations from toolCallLog.
        // Custom agent tool names come from the builder's agentTools config.
        const customAgentToolNames = (config as { agentToolNames?: readonly string[] }).agentToolNames ?? [];
        const subagentInvocations = toolCallLog
          .filter((e) => isSubagentCall(e.toolName, customAgentToolNames))
          .map((e) => ({ delegated: true, succeeded: e.success }));

        // Arguments ride ToolCallCompleted.args when the emitter carries them
        // (the collector copies them onto the log). Calls whose emitter dropped
        // the args are UNKNOWN, not invalid: score only calls that carry args,
        // and report 1.0 (no evidence of invalid args) when none do — scoring
        // missing args as `{}` would read as 0% validity.
        const callsWithArgs = toolCallLog.filter((e) => e.arguments !== undefined);
        const toolArgValidityRate =
          callsWithArgs.length === 0
            ? 1
            : computeArgValidityRate(
                callsWithArgs.map((e) => ({ toolName: e.toolName, arguments: e.arguments })),
              );

        // Act-or-answer counts relayed by the kernel; `{}` (fields absent) without a tally.
        const actOrAnswer = readActOrAnswerCounts(rr?.metadata);

        if (telemetryEnabled) {
          const client = new TelemetryClientImpl(telemetryEndpoint(config.reactiveIntelligenceOptions));

          const modelEntry = lookupModelFn(modelId, undefined, String(config.provider ?? ""));
          const taskText = extractTaskText(task.input);
          const strategySwitched = !!rr?.metadata?.strategyFallback;

          const outcome = runOutcome;

          // ── Enrichment fields (see telemetry-enrichment.ts for logic + tests) ──
          const trajectoryFingerprint = buildTrajectoryFingerprint(entropyLog);
          const abstractToolPattern = toolsUsed.map(abstractifyToolName);
          const iterationsToFirstConvergence = firstConvergenceIteration(entropyLog);
          const contextPressurePeak = peakContextPressure(entropyLog);

          // Skills: use autoActivateSkills (actually injected at bootstrap), not resolvedSkills (full catalog)
          const activeSkills = (ctx.metadata.autoActivateSkills ?? []) as ReadonlyArray<{ source: string }>;
          const skillsActiveCount = activeSkills.length;
          const learnedSkillsContribution = activeSkills.some(s => s.source === "learned");

          // ctx.iteration starts at 1 and increments AFTER each loop, so N real iterations = ctx.iteration - 1
          const realIterations = ctx.iteration - 1;
          const taskComplexity = deriveTaskComplexity(realIterations, toolCallLog.length, strategySwitched, contextPressurePeak);
          const failurePattern = deriveFailurePattern(outcome, terminatedByRaw, errorsFromLoop, contextPressurePeak);

          const reasoningStepsForTelemetry = ctx.metadata.reasoningSteps ?? [];
          const thoughtToActionRatio = deriveThoughtToActionRatio(reasoningStepsForTelemetry, toolCallLog.length);

          const classifierAcc = diffClassifierAccuracy(
            effectiveRequiredTools ?? [],
            toolCallLog.map((e) => e.toolName),
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
            // An abstention rides `terminatedBy: "abstained"`; the wire enum has no label for it yet.
            terminatedBy: terminatedByRaw,
            outcome: toRiWireOutcome(outcome),
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
            // Act-or-answer (forced tool call) outcomes
            ...actOrAnswer,
          });
        }

        // Persist a local observation (disk only, never uploaded; best-effort,
        // never blocks). Written whether or not the upload above is on: local
        // calibration learns from it.
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
            actOrAnswer,
          });
          // The scripted test provider writes only to an explicit dir, never
          // the user's real ~/.reactive-agents/observations.
          const observationsDir = process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
          if (String(config.provider) !== "test" || observationsDir !== undefined) {
            persistRunObservation(modelId, observation, { baseDir: observationsDir });
          }
        } catch {
          // Observer failure must not affect the run
        }
      } catch {
        // Telemetry must never affect agent — silent failure
      }
    }
  });
};
