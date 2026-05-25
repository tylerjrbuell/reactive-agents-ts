import { Effect, Context, Layer, Ref, Option, Queue, Stream as EStream, Duration, FiberRef, Logger } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "./types.js";
import {
  ExecutionError,
  GuardrailViolationError,
  KillSwitchTriggeredError,
  BehavioralContractViolationError,
  MaxIterationsError,
  type RuntimeErrors,
} from "./errors.js";
import { LifecycleHookRegistry } from "./hooks.js";
import type { LifecycleHook } from "./types.js";

import type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
import { StreamingTextCallback, RunControllerRef } from "@reactive-agents/core";

// Import from other packages (type-only to avoid circular deps at runtime)
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import type { ContextProfile } from "@reactive-agents/reasoning";
import { inferRequiredTools, classifyToolRelevance, filterToolsByRelevance, ReasoningService } from "@reactive-agents/reasoning";
import {
  ToolService,
  BUILTIN_TOOL_NAMES,
  buildFinalAnswerDescription,
  buildFinalAnswerOutputDescription,
} from "@reactive-agents/tools";
import { extractOutputFormat } from "@reactive-agents/reasoning";
import { ObservabilityService, createProgressLogger, renderCalibrationProvenance, ObservableLogger, makeObservableLogger, makeStatusRenderer } from "@reactive-agents/observability";
import { GuardrailService, KillSwitchService, BehavioralContractService } from "@reactive-agents/guardrails";
import { EventBus, EntropySensorService } from "@reactive-agents/core";
import type { AgentEvent, KernelStateLike } from "@reactive-agents/core";
import { type AgentDebrief } from "./debrief.js";
import { PlanStoreService, ProceduralMemoryService } from "@reactive-agents/memory";
import { classifyTaskCategory as classifyTaskCategoryFn, skillFragmentToProceduralEntry, loadObservations } from "@reactive-agents/reactive-intelligence";
import { resolveModelCalibration, resolveModelCalibrationAsync } from "./calibration-resolver.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { resolveCapability } from "@reactive-agents/llm-provider";
import { literalMentionRequired } from "./classifier-bypass.js";
import { resolveSynthesisConfigForStrategy } from "./synthesis-resolve.js";
import { formatTaskContextForChat } from "./chat.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ─── Phase pipeline (W23 decomposition) ───
import { runGuardedPhase, runObservablePhase } from "./engine/pipeline.js";
import type { PhaseDeps } from "./engine/runtime-context.js";
import { audit } from "./engine/phases/audit.js";
import { bootstrap } from "./engine/phases/bootstrap.js";
import { complete } from "./engine/phases/complete.js";
import { guardrail } from "./engine/phases/guardrail.js";
import { costRoute } from "./engine/phases/cost-route.js";
import { costTrack } from "./engine/phases/cost-track.js";
import { memoryFlush } from "./engine/phases/memory-flush.js";
import { strategySelect } from "./engine/phases/strategy-select.js";
import { verify } from "./engine/phases/verify.js";
import { logVerifySummary } from "./engine/phases/verify-summary-log.js";
import { dispatchMemoryFlush } from "./engine/phases/memory-flush-dispatch.js";
import { resolveCalibration } from "./engine/phases/agent-loop/setup/calibration.js";
import { prepareReasoningToolSchemas } from "./engine/phases/agent-loop/setup/tool-schemas.js";
import { checkSemanticCache } from "./engine/phases/agent-loop/cache-check.js";
import { runInlineThink } from "./engine/phases/agent-loop/inline-think.js";
import { runInlineAct } from "./engine/phases/agent-loop/inline-act.js";
import { runInlineObserve } from "./engine/phases/agent-loop/inline-observe.js";
import { runInlineHarnessHooks } from "./engine/phases/agent-loop/inline-harness-hooks.js";
import { runVerificationThinkRetry } from "./engine/phases/agent-loop/verification-think-retry.js";
import { runReasoningHarnessHooks } from "./engine/phases/agent-loop/reasoning-harness-hooks.js";
import { runReasoningThink } from "./engine/phases/agent-loop/reasoning-think.js";
import { runReasoningPostThink } from "./engine/phases/agent-loop/reasoning-post-think.js";
import { subscribeReasoningStreamLogger } from "./engine/phases/agent-loop/reasoning-stream-logger.js";
import { runVerificationQualityGate } from "./engine/phases/agent-loop/verification-quality-gate.js";
import { runIterationGuards } from "./engine/phases/agent-loop/iteration-guards.js";
import { runBootstrapSkillPostprocess } from "./engine/bootstrap/skill-postprocess.js";
import { runPreLoopDispatch } from "./engine/phases/agent-loop/setup/pre-loop-dispatch.js";
import { captureFinalSnapshot } from "./engine/finalize/snapshot-final.js";
import { makeExecuteStream } from "./engine/execute-stream.js";
import { synthesizeAndStoreDebrief } from "./engine/finalize/debrief-synthesis.js";
import { emitTelemetryRunReport } from "./engine/finalize/telemetry-emit.js";
import { runLocalLearning } from "./engine/finalize/local-learning.js";
import { finalizeRun } from "./engine/finalize/run-finalize.js";

// ─── Narrow service types for optional deps ───

type ObsLike = {
  withSpan: <A, E>(name: string, effect: Effect.Effect<A, E>, attrs?: Record<string, unknown>) => Effect.Effect<A, E>;
  incrementCounter: (name: string, value?: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  recordHistogram: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  setGauge: (name: string, value: number, labels?: Record<string, string>) => Effect.Effect<void, never>;
  captureSnapshot: (agentId: string, state: Record<string, unknown>) => Effect.Effect<unknown, never>;
  debug: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void, never>;
  info: (msg: string, meta?: Record<string, unknown>) => Effect.Effect<void, never>;
  getTraceContext: () => Effect.Effect<{ traceId: string; spanId: string }, never>;
  flush: () => Effect.Effect<void, never>;
  verbosity: () => string;
};

type EbLike = {
  publish: (event: AgentEvent) => Effect.Effect<void, never>;
  on: <T extends AgentEvent["_tag"]>(
    tag: T,
    handler: (event: Extract<AgentEvent, { _tag: T }>) => Effect.Effect<void, never>,
  ) => Effect.Effect<() => void, never>;
};

// ─── Service Tag ───

export class ExecutionEngine extends Context.Tag("ExecutionEngine")<
  ExecutionEngine,
  {
    readonly execute: (
      task: Task,
    ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;

    readonly registerHook: (hook: LifecycleHook) => Effect.Effect<void, never>;

    readonly getContext: (
      taskId: string,
    ) => Effect.Effect<ExecutionContext | null, never>;

    readonly cancel: (taskId: string) => Effect.Effect<void, ExecutionError>;

    readonly executeStream: (
      task: Task,
      options?: { density?: StreamDensity; runController?: import("@reactive-agents/core").RunControllerLike },
    ) => Effect.Effect<EStream.Stream<AgentStreamEvent, Error>>;
  }
>() {}

// Deduplicates RI telemetry notice across runs within the same process
let _riTelemetryNoticeEmitted = false;

// ─── Pure helpers hoisted to engine/util.ts (W24-E step 1) ───
// Re-exported here for backward compatibility with external importers.
export { checkAllowedToolsMismatch } from "./engine/util.js";
import {
  sanitizeOutput,
  extractTaskText,
  classifyComplexity,
  buildAutoMaxCallsPerTool,
  normalizeReasoningResult,
  resolveModelName,
  type TaskComplexity,
  type ExecutionReasoningResult,
  briefResolvedSkillsFromMetadata,
} from "./engine/util.js";
export { classifyComplexity, buildAutoMaxCallsPerTool, type TaskComplexity } from "./engine/util.js";

// ─── Live Implementation ───

export const ExecutionEngineLive = (config: ReactiveAgentsConfig) =>
  Layer.effect(
    ExecutionEngine,
    Effect.gen(function* () {
      const hookRegistry = yield* LifecycleHookRegistry;

      // Track running contexts (taskId -> ExecutionContext)
      const runningContexts = yield* Ref.make<Map<string, ExecutionContext>>(
        new Map(),
      );

      // Track cancelled task IDs
      const cancelledTasks = yield* Ref.make<Set<string>>(new Set());

      // (W26-A step 1) Removed duplicate `runPhase` + `runObservablePhase` closures —
      // the equivalents live in `./engine/pipeline.ts` and are reused via the local
      // `guardedPhase` wrapper at the executeCore site (which now calls into
      // `runObservablePhase` with the already-constructed `PhaseDeps`).

      let execute = (task: Task): Effect.Effect<TaskResult, RuntimeErrors> =>
        (
          Effect.gen(function* () {
            const now = new Date();
            const executionStartMs = Date.now();
            const sessionId = `session-${Date.now()}`;

            // ── H1: Acquire ObservabilityService optionally ──
            const obsOpt = yield* Effect.serviceOption(
              ObservabilityService,
            ).pipe(
              Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
            );
            const obs: ObsLike | null = obsOpt._tag === "Some" ? (obsOpt.value as unknown as ObsLike) : null;

            // Verbosity helpers — read once per execution
            const verbosity = (obs?.verbosity?.() ?? config.observabilityVerbosity) ?? "normal";
            const isNormal = verbosity !== "minimal";
            const isVerbose = verbosity === "verbose" || verbosity === "debug";
            const isDebug = verbosity === "debug";
            // logModelIO: explicit opt-in/out for full prompt/response dumps.
            // Default: true when debug, false otherwise.
            const logModelIO = config.logModelIO ?? isDebug;

            // Log prefix for visual nesting (sub-agents use "  │ " to indent).
            // Wrap obs methods once to auto-prepend prefix to all log lines.
            const lp = config.logPrefix ?? "";
            if (obs && lp) {
              const origInfo = obs.info.bind(obs);
              const origDebug = obs.debug.bind(obs);
              (obs as any).info = (msg: string, meta?: Record<string, unknown>) => origInfo(`${lp}${msg}`, meta);
              (obs as any).debug = (msg: string, meta?: Record<string, unknown>) => origDebug(`${lp}${msg}`, meta);
            }

            // ── Phase 0.2: Acquire EventBus optionally ──
            const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
              Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
            );
            const eb: EbLike | null = ebOpt._tag === "Some" ? ebOpt.value : null;

            // ── Collect ToolCallCompleted events for debrief ──
            // Track the current kernel iteration so parallel tool calls in the same
            // turn share the same `iteration` value. ReasoningStepCompleted fires per
            // iteration and carries `event.step` — we read it via a mutable counter.
            let _currentKernelIteration = 0;
            const toolCallLog: { toolName: string; durationMs: number; success: boolean; iteration: number }[] = [];
            const rationaleLog: {
              iteration: number;
              decision: string;
              toolName?: string;
              rationale: { why: string; refs?: readonly string[]; confidence?: number };
            }[] = [];
            if (eb) {
              yield* eb.on("ReasoningStepCompleted", (event) =>
                Effect.sync(() => { _currentKernelIteration = event.step ?? _currentKernelIteration; }),
              );
              yield* eb.on("ToolCallCompleted", (event) =>
                Effect.sync(() => { toolCallLog.push({ toolName: event.toolName, durationMs: event.durationMs, success: event.success, iteration: _currentKernelIteration }); }),
              );
              // Collect rationale from ToolCallStarted events
              yield* eb.on("ToolCallStarted", (event) => {
                if (event.rationale) {
                  return Effect.sync(() => {
                    rationaleLog.push({
                      iteration: _currentKernelIteration,
                      decision: "tool-selection",
                      toolName: event.toolName,
                      rationale: {
                        why: event.rationale!.why,
                        refs: event.rationale!.refs,
                        confidence: event.rationale!.confidence,
                      },
                    });
                  });
                }
                return Effect.void;
              });

              // ── Milestone decision capture (v0.11.x) ──
              // Surface every task-advancing decision in debrief.rationale[], not
              // just tool calls. Each emitter already records a "why" string;
              // promote it into structured Rationale shape with a decision tag.

              // Curator decisions — already carry structured Rationale (required).
              yield* eb.on("CuratorDecisionEmitted", (event) =>
                Effect.sync(() => {
                  rationaleLog.push({
                    iteration: event.iteration,
                    decision: `curator-${event.action}`,
                    rationale: {
                      why: event.rationale.why,
                      refs: event.rationale.refs,
                      confidence: event.rationale.confidence,
                    },
                  });
                }),
              );

              // Strategy switches — promote `reason` string into structured form.
              yield* eb.on("StrategySwitched", (event) =>
                Effect.sync(() => {
                  if (!event.reason || event.reason.trim().length === 0) return;
                  rationaleLog.push({
                    iteration: _currentKernelIteration,
                    decision: `strategy-switch:${event.from}→${event.to}`,
                    rationale: {
                      why: event.reason.slice(0, 280),
                    },
                  });
                }),
              );

              // Reactive interventions — corrective dispatch (early-stop, branch, compress…).
              yield* eb.on("ReactiveDecision", (event) =>
                Effect.sync(() => {
                  if (!event.reason || event.reason.trim().length === 0) return;
                  rationaleLog.push({
                    iteration: event.iteration,
                    decision: `reactive-${event.decision}`,
                    rationale: {
                      why: event.reason.slice(0, 280),
                      ...(typeof event.entropyAfter === "number" && typeof event.entropyBefore === "number"
                        ? { confidence: Math.max(0, Math.min(1, 1 - Math.abs(event.entropyAfter - event.entropyBefore))) }
                        : {}),
                    },
                  });
                }),
              );

              // Termination — captured from KernelStateSnapshotEmitted when terminationRationale present.
              const terminationSeen = new Set<string>();
              yield* eb.on("KernelStateSnapshotEmitted", (event) => {
                const tr = event.terminationRationale;
                if (!tr || !event.terminatedBy) return Effect.void;
                const dedup = `${event.taskId}:${event.terminatedBy}`;
                if (terminationSeen.has(dedup)) return Effect.void;
                terminationSeen.add(dedup);
                return Effect.sync(() => {
                  rationaleLog.push({
                    iteration: event.iteration,
                    decision: `termination:${event.terminatedBy}`,
                    rationale: {
                      why: tr.why,
                      refs: tr.refs,
                      confidence: tr.confidence,
                    },
                  });
                });
              });
            }

            // ── Collect EntropyScored events for telemetry + dashboard ──
            const entropyLog: {
              iteration: number;
              composite: number;
              sources: { token: number | null; structural: number; semantic: number | null; behavioral: number; contextPressure: number };
              trajectory: { derivative: number; shape: string; momentum: number };
              confidence: "high" | "medium" | "low";
            }[] = [];
            const entropySeenIterations = new Set<string>();
            if (eb) {
              yield* eb.on("EntropyScored", (event) =>
                Effect.sync(() => {
                  // Dedup: kernel-runner inline scoring + event subscriber may both
                  // publish EntropyScored for the same (taskId, iteration) pair.
                  const key = `${event.taskId}:${event.iteration}`;
                  if (entropySeenIterations.has(key)) return;
                  entropySeenIterations.add(key);
                  entropyLog.push({
                    iteration: event.iteration,
                    composite: event.composite,
                    sources: event.sources,
                    trajectory: event.trajectory,
                    confidence: event.confidence,
                  });
                }),
              );
            }

            // ── EventBus-driven entropy scoring ──
            // Subscribe to ReasoningStepCompleted events from ALL strategies and score
            // thoughts via EntropySensorService. This covers strategies like plan-execute
            // that bypass kernel-runner's inline scoring.
            // Dedup: tracks (taskId, step) pairs to avoid double-scoring with kernel-runner.
            if (eb && config.enableReactiveIntelligence) {
              const esOpt = yield* Effect.serviceOption(EntropySensorService).pipe(
                Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
              );
              if (esOpt._tag === "Some") {
                const sensor = esOpt.value;
                const scoredPairs = new Set<string>();
                const taskThoughts = new Map<string, { thoughts: string[]; steps: { type: string; content: string }[]; toolsUsed: Set<string> }>();

                yield* eb.on("ReasoningStepCompleted", (event) =>
                  Effect.gen(function* () {
                    if (!event.thought) return;
                    const dedupKey = `${event.taskId}:${event.step}`;
                    if (scoredPairs.has(dedupKey)) return;

                    let tState = taskThoughts.get(event.taskId);
                    if (!tState) {
                      tState = { thoughts: [], steps: [], toolsUsed: new Set() };
                      taskThoughts.set(event.taskId, tState);
                    }
                    tState.steps.push({ type: "thought", content: event.thought });
                    if (event.action) {
                      tState.steps.push({ type: "action", content: event.action });
                      try { const p = JSON.parse(event.action); if (p.tool) tState.toolsUsed.add(p.tool); } catch {}
                    }
                    if (event.observation) tState.steps.push({ type: "observation", content: event.observation });

                    const priorThought = tState.thoughts.length > 0 ? tState.thoughts[tState.thoughts.length - 1] : undefined;
                    tState.thoughts.push(event.thought);

                    const kernelState: KernelStateLike = {
                      taskId: event.taskId, strategy: event.strategy, kernelType: "event-subscriber",
                      steps: tState.steps.map((s) => ({ type: s.type, content: s.content })),
                      toolsUsed: tState.toolsUsed, iteration: event.step, tokens: 0,
                      status: "thinking", output: null, error: null, meta: {},
                    };

                    const score = yield* sensor.score({
                      thought: event.thought, taskDescription: extractTaskText(task.input), strategy: event.strategy,
                      iteration: event.step, maxIterations: config.maxIterations ?? 10,
                      modelId: String(config.defaultModel ?? "unknown"), temperature: 0, priorThought, kernelState,
                      taskCategory: classifyTaskCategoryFn(extractTaskText(task.input)),
                    });

                    scoredPairs.add(dedupKey);

                    yield* eb.publish({
                      _tag: "EntropyScored", taskId: event.taskId, iteration: score.iteration,
                      composite: score.composite, sources: score.sources,
                      trajectory: {
                        derivative: score.trajectory.derivative,
                        shape: score.trajectory.shape as "converging" | "flat" | "diverging" | "v-recovery" | "oscillating",
                        momentum: score.trajectory.momentum,
                      },
                      confidence: score.confidence,
                      modelTier: score.modelTier, iterationWeight: score.iterationWeight,
                    });
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:641", tag: errorTag(err) }))),
                );
              }
            }

            // ── Acquire KillSwitchService optionally ──
            const ksOpt = config.enableKillSwitch
              ? yield* Effect.serviceOption(KillSwitchService).pipe(
                  Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                )
              : { _tag: "None" as const };
            const ks = ksOpt._tag === "Some" ? ksOpt.value : null;

            // ── PhaseDeps bundle (W23 decomposition) ──
            // Long-lived dependency bundle threaded through every extracted phase.
            // Grows as more phases are pulled out; only fields consumed by
            // already-extracted phases are populated.
            const deps: PhaseDeps = {
              task,
              config,
              hooks: hookRegistry,
              obs,
              eb,
              ks: ks as unknown,
              guardrail: null,
              behavioral: null,
              tools: null,
              state: { cancelledTasks, runningContexts },
              isNormal,
              executionStartMs,
            };

            // Wrap entire execution in root observability span
            const executeCore = (): Effect.Effect<TaskResult, RuntimeErrors, any> =>
              Effect.gen(function* () {

                // Initialize context
                let ctx: ExecutionContext = {
                  taskId: task.id,
                  agentId: task.agentId,
                  sessionId,
                  phase: "bootstrap",
                  agentState: "bootstrapping",
                  iteration: 1,
                  maxIterations: config.maxIterations,
                  messages: [],
                  toolResults: [],
                  cost: 0,
                  tokensUsed: 0,
                  startedAt: now,
                  selectedModel: config.defaultModel,
                  provider: config.provider,
                  metadata: {},
                };

                // Classify task category once — used for entropy scoring and telemetry
                const taskCategory = classifyTaskCategoryFn(extractTaskText(task.input));

                // Register context as running
                yield* Ref.update(runningContexts, (m) =>
                  new Map(m).set(task.id, ctx),
                );

                // Emit execution started event
                yield* Effect.serviceOption(ObservableLogger).pipe(
                  Effect.tap((loggerOpt) => {
                    if (loggerOpt._tag === "Some") {
                      return loggerOpt.value.emit({
                        _tag: "phase_started",
                        phase: "execution",
                        timestamp: new Date(),
                      });
                    }
                    return Effect.void;
                  }),
                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:697", tag: errorTag(err) })),
                );

                // Emit RI telemetry notice once per process via structured log
                if (config.enableReactiveIntelligence && !_riTelemetryNoticeEmitted) {
                  const riOpts = config.reactiveIntelligenceOptions as Record<string, unknown> | undefined;
                  const telemetryCfg = riOpts?.telemetry;
                  const telemetryEnabled = telemetryCfg === undefined || telemetryCfg === true ||
                    (typeof telemetryCfg === "object" && telemetryCfg !== null &&
                      (telemetryCfg as Record<string, unknown>)["enabled"] !== false);
                  if (telemetryEnabled) {
                    _riTelemetryNoticeEmitted = true;
                    yield* Effect.serviceOption(ObservableLogger).pipe(
                      Effect.tap((loggerOpt) => {
                        if (loggerOpt._tag === "Some") {
                          return loggerOpt.value.emit({
                            _tag: "notice",
                            level: "info",
                            title: "Reactive Intelligence",
                            message: "Anonymous entropy data helps improve the framework. Disable with .withReactiveIntelligence({ telemetry: false })",
                            docsLink: "https://docs.reactiveagents.dev/telemetry",
                            dismissible: true,
                            timestamp: new Date(),
                          });
                        }
                        return Effect.void;
                      }),
                      Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:724", tag: errorTag(err) })),
                    );
                  }
                }

                // ── Lifecycle guard helper ──
                const checkLifecycle = (taskId: string): Effect.Effect<void, RuntimeErrors> =>
                  Effect.gen(function* () {
                    if (!ks) return;
                    const status = yield* ks.waitIfPaused(config.agentId, taskId)
                      .pipe(Effect.catchAll(() => Effect.succeed("ok" as const)));
                    if (status === "stopping") {
                      if (eb) yield* eb.publish({ _tag: "AgentStopping", agentId: config.agentId,
                        taskId, reason: "stop() requested" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:737", tag: errorTag(err) })));
                      if (eb) yield* eb.publish({ _tag: "AgentStopped", agentId: config.agentId,
                        taskId, reason: "stop() requested" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:739", tag: errorTag(err) })));
                      return yield* Effect.fail(new KillSwitchTriggeredError({
                        message: `Agent ${config.agentId} stopping gracefully`,
                        taskId, agentId: config.agentId, reason: "stop() requested",
                      }));
                    }
                    const ksStatus = (yield* ks.isTriggered(config.agentId)
                      .pipe(Effect.catchAll(() => Effect.succeed({ triggered: false })))) as { triggered: boolean; reason?: string };
                    if (ksStatus.triggered) {
                      if (eb) yield* eb.publish({ _tag: "AgentTerminated", agentId: config.agentId,
                        taskId, reason: ksStatus.reason ?? "terminated" }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:749", tag: errorTag(err) })));
                      return yield* Effect.fail(new KillSwitchTriggeredError({
                        message: `Kill switch triggered for agent ${config.agentId}: ${ksStatus.reason ?? "no reason"}`,
                        taskId, agentId: config.agentId, reason: ksStatus.reason ?? "no reason",
                      }));
                    }
                  });

                // ── Guarded phase wrapper: lifecycle check before every phase ──
                // (W26-A step 1) Reuses runObservablePhase from engine/pipeline.ts
                // with the already-constructed PhaseDeps `deps` (line 547 above).
                const guardedPhase = <E>(
                  gCtx: ExecutionContext,
                  phase: ExecutionContext["phase"],
                  body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
                ): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
                  checkLifecycle(gCtx.taskId).pipe(
                    Effect.zipRight(runObservablePhase(gCtx, phase, body, deps)),
                  );

                if (obs) {
                  yield* obs.info("Execution started", {
                    taskId: task.id,
                    agentId: task.agentId,
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:771", tag: errorTag(err) })));
                }

                if (eb) {
                  const deskName =
                    typeof config.agentId === "string" && config.agentId.trim().length > 0
                      ? config.agentId.trim()
                      : "";
                  const agentDisplayName =
                    deskName.length > 0 && !/^cortex-desk-\d+$/.test(deskName) ? deskName : undefined;
                  yield* eb.publish({
                    _tag: "AgentStarted",
                    taskId: ctx.taskId,
                    agentId: config.agentId,
                    provider: String(ctx.provider ?? "unknown"),
                    model: String(ctx.selectedModel ?? "unknown"),
                    timestamp: executionStartMs,
                    ...(task.metadata?.context?.["parentAgentId"]
                      ? { parentAgentId: String(task.metadata.context["parentAgentId"]) }
                      : {}),
                    ...(agentDisplayName ? { agentDisplayName } : {}),
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:792", tag: errorTag(err) })));
                }

                // ── Phase 1: BOOTSTRAP ──
                // Extracted to engine/phases/bootstrap.ts (W23). The post-bootstrap
                // initialization that follows (skill application, tip injection,
                // MemorySnapshot publishing) is orchestrator-level work and stays
                // inline for now.
                ctx = yield* runGuardedPhase(bootstrap, ctx, deps);

                ctx = yield* runBootstrapSkillPostprocess({
                  ctx,
                  task,
                  config,
                  eb,
                  obs,
                  isNormal,
                  bootstrapStartedAt: now,
                });

                // ── Phase 5: AGENT_LOOP ──

                // Resolve CalibrationMode → ModelCalibration | undefined once.
                // Placed here (before Phase 2–4 dispatchers) so classifierReliability is
                // available inside the pre-loop block, and so the same resolved value can
                // be threaded into all three execute() call sites below.
                // Extracted to engine/phases/agent-loop/setup/calibration.ts (W23 step 4).
                const resolvedCalibration: ModelCalibration | undefined = yield* resolveCalibration(config);

                // ── Phases 2–4 + tool registry + classify + autoMaxCallsPerTool ──
                // Extracted to engine/phases/agent-loop/setup/pre-loop-dispatch.ts (W24-C step 2).
                // Semantic cache check stays inline because its result feeds the cacheHit
                // branch selector immediately below.
                const preLoop = yield* runPreLoopDispatch({
                  ctx,
                  task,
                  config,
                  deps,
                  resolvedCalibration,
                  obs,
                  isNormal,
                  guardrail,
                  costRoute,
                  strategySelect,
                });
                ctx = preLoop.ctx;
                const effectiveAllowedTools = preLoop.effectiveAllowedTools;
                const effectiveFocusedTools = preLoop.effectiveFocusedTools;
                const { effectiveRequiredTools, effectiveRequiredToolQuantities, classifiedRelevantTools } = preLoop;
                const autoMaxCallsPerTool = preLoop.autoMaxCallsPerTool;
                const cachedToolDefs = preLoop.cachedToolDefs;

                // ── Semantic cache check (before reasoning) ──
                // Extracted to engine/phases/agent-loop/cache-check.ts (W23 step 5).
                // On hit: ctx.metadata is populated with the cached response;
                // cost-track phase reads ctx.metadata.cacheHit. Behavior locked
                // in by tests/semantic-cache-hit.test.ts (step 1 regression
                // anchor).
                const cacheCheckResult = yield* checkSemanticCache({ config, task, ctx, obs, isNormal });
                ctx = cacheCheckResult.ctx;
                let cacheHit = cacheCheckResult.cacheHit;

                const reasoningOpt = yield* Effect.serviceOption(ReasoningService);

                if (reasoningOpt._tag === "Some" && !cacheHit) {
                  // ── Full reasoning path ──
                  // Reuse cached tool definitions (fetched once above)
                  const initialToolSchemas = cachedToolDefs.map((t: any) => ({
                    name: t.name as string,
                    description: t.description as string,
                    parameters: (t.parameters ?? []).map((p: any) => ({
                      name: p.name as string,
                      type: p.type as string,
                      description: p.description as string,
                      required: Boolean(p.required),
                    })),
                  }));
                  const initialToolNames = cachedToolDefs.map((t: any) => t.name as string);

                  // Snapshot the full unfiltered schemas for the completion guard
                  const allToolSchemas = [...initialToolSchemas];

                  // ── Tool schema preparation: built-ins opt-in + dynamic final-answer
                  // + allowedTools prompt filter + adaptive filter ──
                  // Body extracted to engine/phases/agent-loop/setup/tool-schemas.ts (W23 step 6a-6).
                  const prepared = yield* prepareReasoningToolSchemas({
                    config,
                    task,
                    availableToolSchemas: initialToolSchemas,
                    availableToolNames: initialToolNames,
                    effectiveAllowedTools,
                    effectiveFocusedTools,
                    effectiveRequiredTools,
                    classifiedRelevantTools,
                    resolvedCalibration,
                    obs,
                    isNormal,
                  });
                  const availableToolSchemas = prepared.availableToolSchemas;
                  const availableToolNames = prepared.availableToolNames;

                  // ── Subscribe to reasoning steps for live streaming ──
                  // Body extracted to engine/phases/agent-loop/reasoning-stream-logger.ts (W23 step 6a-7).
                  const unsubscribeReasoningSteps = yield* subscribeReasoningStreamLogger({
                    eb, obs, logModelIO, isVerbose, isDebug,
                  });

                  // Body extracted to engine/phases/agent-loop/reasoning-think.ts (W23 step 6a-4).
                  ctx = yield* guardedPhase(ctx, "think", (c) =>
                    runReasoningThink(c, {
                      config,
                      task,
                      reasoningService: reasoningOpt.value,
                      availableToolNames,
                      availableToolSchemas,
                      allToolSchemas,
                      effectiveAllowedTools,
                      effectiveRequiredTools,
                      effectiveRequiredToolQuantities,
                      classifiedRelevantTools,
                      autoMaxCallsPerTool,
                      taskCategory,
                      resolvedCalibration,
                      obs,
                    }),
                  );

                  // ── Unsubscribe from reasoning step events ──
                  if (unsubscribeReasoningSteps) {
                    unsubscribeReasoningSteps();
                  }

                  // ── Harness hooks (post-think) ─────────────────────────────────────
                  // Body extracted to engine/phases/agent-loop/reasoning-harness-hooks.ts (W23 step 6a-3).
                  ctx = yield* runReasoningHarnessHooks(ctx, {
                    config,
                    task,
                    cacheHit,
                    reasoningOpt,
                    availableToolNames,
                    availableToolSchemas,
                    allToolSchemas,
                    effectiveRequiredTools,
                    effectiveRequiredToolQuantities,
                    classifiedRelevantTools,
                    autoMaxCallsPerTool,
                    taskCategory,
                    resolvedCalibration,
                    obs,
                  });

                  // ── Post-think bookkeeping (log summary, episodic bridge, experience,
                  // synthetic act/observe hooks, iteration update, semantic cache store) ──
                  // Body extracted to engine/phases/agent-loop/reasoning-post-think.ts (W23 step 6a-5).
                  ctx = yield* runReasoningPostThink(ctx, {
                    config,
                    task,
                    obs,
                    isNormal,
                    fireActObserveHooks: (c) =>
                      Effect.gen(function* () {
                        let cc = yield* guardedPhase(c, "act", (cx) => Effect.succeed(cx));
                        cc = yield* guardedPhase(cc, "observe", (cx) => Effect.succeed(cx));
                        return cc;
                      }) as Effect.Effect<ExecutionContext, never>,
                  });
                } else if (!cacheHit) {
                  // ── Minimal direct-LLM loop ──
                  // Seed messages with the user's prompt before the first LLM call
                  ctx = {
                    ...ctx,
                    messages: [
                      {
                        role: "user",
                        content: extractTaskText(task.input),
                      },
                    ],
                  };

                  // Get tools in function-calling format for LLM requests
                  const functionCallingTools = yield* Effect.serviceOption(
                    ToolService,
                  ).pipe(
                    Effect.flatMap((opt) =>
                      opt._tag === "Some"
                        ? opt.value.toFunctionCallingFormat()
                        : Effect.succeed([] as readonly any[]),
                    ),
                    Effect.catchAll(() => Effect.succeed([] as readonly any[])),
                  );

                  // Collect available tool names for hook context enrichment (Phase 1.4)
                  const availableToolNames = functionCallingTools.map((t: any) => t.name as string);

                  // H3: Get ContextWindowManager for proper context building (Phase 1.1)
                  const contextManagerOpt = yield* Effect.serviceOption(
                    Context.GenericTag<{
                      buildContext: (options: {
                        systemPrompt: string;
                        messages: readonly unknown[];
                        memoryContext?: string;
                        maxTokens: number;
                        reserveOutputTokens: number;
                      }) => Effect.Effect<readonly unknown[], unknown>;
                      truncate: (
                        messages: readonly unknown[],
                        targetTokens: number,
                        strategy: string,
                      ) => Effect.Effect<readonly unknown[], unknown>;
                    }>("ContextWindowManager"),
                  ).pipe(
                    Effect.catchAll(() =>
                      Effect.succeed({ _tag: "None" as const }),
                    ),
                  );

                  let isComplete = false;

                  // Create progress logger for per-iteration visibility
                  const verbosity = obs ? (obs.verbosity() as "minimal" | "normal" | "verbose" | "debug") : "minimal";
                  const progressLogger = createProgressLogger(verbosity);

                  while (!isComplete && ctx.iteration <= ctx.maxIterations) {
                    // ── Per-iteration guards (lifecycle / behavioral / budget / events / gauge) ──
                    // Body extracted to engine/phases/agent-loop/iteration-guards.ts (W24-D step 1).
                    {
                      const guardResult = yield* runIterationGuards({
                        ctx,
                        config,
                        eb,
                        obs,
                        checkLifecycle,
                      });
                      ctx = guardResult.ctx;
                      if (guardResult.shouldBreak) {
                        isComplete = true;
                        break;
                      }
                    }

                    // 5a. THINK
                    // Body extracted to engine/phases/agent-loop/inline-think.ts (W23 step 6a-0).
                    ctx = yield* guardedPhase(
                      ctx,
                      "think",
                      (c) =>
                        runInlineThink(c, {
                          config,
                          functionCallingTools,
                          availableToolNames,
                          contextManagerOpt,
                          eb,
                          obs,
                          isVerbose,
                          effectiveContextTokens: resolveCapability(
                            String(c.provider ?? config.provider ?? "unknown"),
                            resolveModelName(c, config),
                          ).recommendedNumCtx,
                        }),
                    );

                    // Log thought phase for per-iteration progress visibility
                    yield* progressLogger.logIteration({
                      iteration: ctx.iteration,
                      maxIterations: ctx.maxIterations,
                      phase: "thought",
                      content: ctx.metadata.lastResponse ?? "",
                    }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2535", tag: errorTag(err) })));

                    // 5b. ACT (if tool calls present) — call real ToolService
                    // Body extracted to engine/phases/agent-loop/inline-act.ts (W23 step 6a-1a).
                    const pendingCalls =
                      ctx.metadata.pendingToolCalls ?? [];
                    if (pendingCalls.length > 0) {
                      ctx = yield* guardedPhase(ctx, "act", (c) =>
                        runInlineAct(c, {
                          config,
                          pendingCalls,
                          eb,
                          obs,
                          isNormal,
                          progressLogger,
                        }),
                      );

                      // Log action phase for each tool call
                      for (const toolResult of (ctx.toolResults.slice(-pendingCalls.length) as any[])) {
                        yield* progressLogger.logIteration({
                          iteration: ctx.iteration,
                          maxIterations: ctx.maxIterations,
                          phase: "action",
                          content: `Tool: ${toolResult.toolName}`,
                          toolName: toolResult.toolName,
                          toolStatus: toolResult.success ? "success" : "error",
                        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2710", tag: errorTag(err) })));
                      }

                      // 5c. OBSERVE — H5: also log episodic memories
                      // Body extracted to engine/phases/agent-loop/inline-observe.ts (W23 step 6a-1b).
                      ctx = yield* guardedPhase(ctx, "observe", (c) =>
                        runInlineObserve(c, {
                          pendingCallCount: pendingCalls.length,
                          obs,
                          isVerbose,
                        }),
                      );

                      // Log observation phase with summary
                      const recentResults = (ctx.toolResults.slice(-pendingCalls.length) as any[]);
                      for (const toolResult of recentResults) {
                        const resultPreview = typeof toolResult.result === "string"
                          ? toolResult.result.slice(0, 100)
                          : JSON.stringify(toolResult.result).slice(0, 100);
                        yield* progressLogger.logIteration({
                          iteration: ctx.iteration,
                          maxIterations: ctx.maxIterations,
                          phase: "observation",
                          content: resultPreview,
                          toolName: toolResult.toolName,
                          toolStatus: toolResult.success ? "success" : "error",
                          errorMessage: toolResult.success ? undefined : (toolResult.result as string),
                        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2828", tag: errorTag(err) })));
                      }

                      // Log iteration summary
                      yield* progressLogger.logIterationSummary(
                        ctx.iteration,
                        ctx.tokensUsed,
                        recentResults.map((r: any) => r.toolName),
                      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2836", tag: errorTag(err) })));
                    } else {
                      // 5d. LOOP_CHECK
                      isComplete = Boolean(ctx.metadata.isComplete);
                      ctx = { ...ctx, iteration: ctx.iteration + 1 };

                      // Log iteration summary even when no tools called
                      yield* progressLogger.logIterationSummary(
                        ctx.iteration - 1,
                        ctx.tokensUsed,
                        [],
                        isComplete ? "final-answer" : "no-tools",
                      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2848", tag: errorTag(err) })));
                    }
                  }

                  // Max iterations reached without completion
                  if (!isComplete && ctx.iteration >= ctx.maxIterations) {
                    return yield* Effect.fail(
                      new MaxIterationsError({
                        message: `Task ${task.id} exceeded max iterations (${ctx.maxIterations})`,
                        taskId: task.id,
                        iterations: ctx.iteration,
                        maxIterations: ctx.maxIterations,
                      }),
                    );
                  }

                  // ── Harness hooks (post-think, direct-LLM path) ────────────────────
                  // Body extracted to engine/phases/agent-loop/inline-harness-hooks.ts (W23 step 6a-1c).
                  ctx = yield* runInlineHarnessHooks(ctx, { config, task, cacheHit, obs });

                  // Phase 0.5: Capture final state snapshot after agent loop
                  // Extracted to engine/finalize/snapshot-final.ts (W26-A step 2).
                  yield* captureFinalSnapshot(ctx, config, obs);
                }

                // ── Phase 6: VERIFY (optional) ── H2
                // Extracted to engine/phases/verify.ts (W23). Skip predicate
                // gates on config.enableVerification.
                ctx = yield* runGuardedPhase(verify, ctx, deps);
                yield* logVerifySummary({ ctx, config, obs, isNormal });

                // ── Verification Quality Gate ──
                // Body extracted to engine/phases/agent-loop/verification-quality-gate.ts (W23 step 6a-8).
                ctx = yield* runVerificationQualityGate(ctx, {
                  config,
                  obs,
                  fireGuardedThinkRetry: (c) =>
                    guardedPhase(c, "think", (cc) =>
                      runVerificationThinkRetry(cc, {
                        config,
                        task,
                        reasoningOpt,
                        taskCategory,
                        resolvedCalibration,
                        obs,
                        eb,
                      }),
                    ) as Effect.Effect<ExecutionContext, never>,
                  runVerifyAgain: (c) =>
                    runGuardedPhase(verify, c, deps) as Effect.Effect<ExecutionContext, never>,
                });

                // ── Phase 7: MEMORY_FLUSH ── H5
                // Dispatch body extracted to engine/phases/memory-flush-dispatch.ts (W24-A step 2).
                ctx = yield* dispatchMemoryFlush({
                  ctx,
                  entropyLog,
                  toolCallLog,
                  runMemoryFlush: (c) =>
                    runGuardedPhase(memoryFlush, c, deps) as Effect.Effect<ExecutionContext, never>,
                });

                // ── Phase 8: COST_TRACK (optional) ── H2
                // Extracted to engine/phases/cost-track.ts (W23). Reads cacheHit
                // from ctx.metadata.cacheHit (set in the agent-loop on cache hit).
                ctx = yield* runGuardedPhase(costTrack, ctx, deps);

                // ── Phase 9: AUDIT (optional) ── H2
                // Extracted to engine/phases/audit.ts (W23). Phase's own `skip` predicate
                // gates on config.enableAudit.
                ctx = yield* runGuardedPhase(audit, ctx, deps);

                // ── Phase 10: COMPLETE ──
                // Extracted to engine/phases/complete.ts (W23). Post-complete
                // orchestrator work below (TaskResult assembly, debrief, RunReport
                // telemetry, calibration/bandit/skill store updates, lifecycle
                // events) is NOT a phase — it's ctx → TaskResult assembly and
                // stays inline.
                ctx = yield* runGuardedPhase(complete, ctx, deps);

                // Build TaskResult — sanitize output to strip internal metadata
                const rr = ctx.metadata.reasoningResult;
                let rawOutput: unknown = ctx.metadata.lastResponse ?? null;
                if (
                  (rawOutput === null || rawOutput === "") &&
                  rr?.steps &&
                  rr.steps.length > 0 &&
                  rr.status !== "failed"
                ) {
                  // Fall back to last *genuine* tool observation. Skip harness-injected
                  // observations (toolName="system", success=false) — those carry harness
                  // guidance text the model parrots ("Your next step: call X..."), not
                  // user-visible deliverables. Without this filter, on a failed/empty
                  // run we ship the last harness nudge as the answer.
                  const lastObs = [...rr.steps].reverse().find((s) => {
                    if (s.type !== "observation") return false;
                    const obs = s.metadata?.observationResult;
                    if (obs && (obs.success === false || obs.toolName === "system")) return false;
                    return true;
                  });
                  if (lastObs?.content) rawOutput = lastObs.content;
                }
                const sanitizedOutput = typeof rawOutput === "string" ? sanitizeOutput(rawOutput) : rawOutput;

                const outputForSuccess =
                  typeof sanitizedOutput === "string"
                    ? sanitizedOutput.trim()
                    : sanitizedOutput != null
                      ? String(sanitizedOutput).trim()
                      : "";
                const hasSubstantiveOutput = outputForSuccess.length > 0;

                // Extract terminatedBy from reasoning metadata, with fallback inference
                const terminatedByRaw = (rr?.metadata?.terminatedBy ?? "end_turn") as
                  "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn" | "llm_error";

                // Extract dialect from reasoning metadata (set by Task 13 resolver threading)
                const dialectObserved = ((rr as any)?.metadata?.lastDialectObserved ?? "none") as
                  "native-fc" | "fenced-json" | "pseudo-code" | "nameless-shape" | "none";

                // Reactive strategy often reports partial + max_iterations whenever the kernel did not
                // reach state "done", even if the last LLM turn produced a usable string. Treat
                // completed, or partial with non-empty output, as success; empty partial as failure.
                const executionSucceeded =
                  rr !== undefined && typeof rr.status === "string"
                    ? rr.status === "failed" || rr.status === "error"
                      ? false
                      : rr.status === "completed" ||
                        (rr.status === "partial" && hasSubstantiveOutput)
                    : Boolean(ctx.metadata.isComplete);

                // ── Debrief Synthesis (best-effort, never blocks the result) ──
                // Extracted to engine/finalize/debrief-synthesis.ts (W24-B step 1).
                const { debrief, errorsFromLoop, executionDurationMs } = yield* synthesizeAndStoreDebrief({
                  ctx,
                  task,
                  config,
                  eb,
                  rr,
                  terminatedByRaw,
                  sanitizedOutput,
                  outputForSuccess,
                  hasSubstantiveOutput,
                  toolCallLog,
                  rationaleLog,
                });

                const result: TaskResult & {
                  format?: string;
                  terminatedBy?: string;
                  debrief?: AgentDebrief;
                } = {
                  taskId: task.id as any,
                  agentId: task.agentId,
                  output: sanitizedOutput,
                  success: executionSucceeded,
                  ...(!executionSucceeded
                    ? {
                        error:
                          outputForSuccess.length > 0
                            ? outputForSuccess
                            : rr?.status === "failed"
                              ? "Reasoning failed"
                              : "Execution did not complete successfully",
                      }
                    : {}),
                  metadata: {
                    duration: executionDurationMs,
                    cost: ctx.cost,
                    tokensUsed: ctx.tokensUsed,
                    strategyUsed: ctx.selectedStrategy,
                    stepsCount: ctx.metadata.stepsCount ?? ctx.iteration,
                    iterations: ctx.iteration,
                    // Forward reasoning steps so chat() can access tool results and analysis.
                    // Cast needed: reasoningSteps is an internal field not in the public TaskResult type.
                    ...(ctx.metadata.reasoningSteps ? { reasoningSteps: ctx.metadata.reasoningSteps } as Record<string, unknown> : {}),
                    ...(rr?.metadata?.confidence !== undefined ? {
                      confidence: (rr.metadata.confidence >= 0.7
                        ? "high"
                        : rr.metadata.confidence >= 0.4
                          ? "medium"
                          : "low") as "high" | "medium" | "low",
                    } : {}),
                    ...(rr?.metadata?.strategyFallback === true ? { strategyFallback: true } : {}),
                    ...(ctx.metadata.budgetExceeded ? { budgetExceeded: true } : {}),
                    // TODO(T11-followup): TaskResult.metadata type is missing 'complexity' — add it to the schema
                    ...({ complexity: ctx.metadata.taskComplexity ?? classifyComplexity(
                      ctx.iteration,
                      entropyLog.length > 0 ? entropyLog[entropyLog.length - 1] : undefined,
                      toolCallLog.length,
                      terminatedByRaw,
                    ) } as Record<string, unknown>),
                    // TODO(T11-followup): TaskResult.metadata type is missing 'llmCalls' — add it to the schema
                    ...({ llmCalls: rr?.metadata?.llmCalls ?? ctx.metadata.llmCalls ?? 0 } as Record<string, unknown>),
                  },
                  completedAt: new Date(),
                  format: "text",
                  terminatedBy: terminatedByRaw,
                  ...(debrief !== undefined ? { debrief } : {}),
                };

                if (obs) {
                  yield* obs.info("Execution completed", {
                    taskId: task.id,
                    success: executionSucceeded,
                    tokensUsed: ctx.tokensUsed,
                    cost: ctx.cost,
                    duration: result.metadata.duration,
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3720", tag: errorTag(err) })));
                }

                if (obs && isNormal) {
                  const durationSec = (result.metadata.duration / 1000).toFixed(1);
                  const costStr = `$${result.metadata.cost.toFixed(4)}`;
                  const toks = ctx.tokensUsed.toLocaleString();
                  yield* obs.info(
                    `◉ [complete]   ✓ ${task.id} | ${toks} tok | ${costStr} | ${durationSec}s`,
                  ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3729", tag: errorTag(err) })));
                }

                // Calibration provenance (Task 21)
                if (obs && resolvedCalibration) {
                  try {
                    const modelId = String(ctx.selectedModel ?? config.defaultModel ?? "unknown");
                    const localObs = loadObservations(modelId, {
                      baseDir: process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"],
                    });
                    const sources: ("prior" | "community" | "local")[] = ["prior"];
                    if (localObs.sampleCount > 0) sources.push("local");
                    const provenance = renderCalibrationProvenance({
                      modelId,
                      sources,
                      localSamples: localObs.sampleCount,
                      summary: {
                        parallelCallCapability: resolvedCalibration.parallelCallCapability,
                        classifierReliability: resolvedCalibration.classifierReliability,
                      },
                    });
                    yield* obs.info(`◉ [calibration] ${provenance}`).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3750", tag: errorTag(err) })));
                  } catch {
                    // Provenance rendering is best-effort
                  }
                }

                // Record final metrics for dashboard
                if (obs) {
                  yield* obs.setGauge("execution.tokens_used", ctx.tokensUsed, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3759", tag: errorTag(err) })));
                  yield* obs.setGauge("execution.total_duration", result.metadata.duration, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3761", tag: errorTag(err) })));
                  yield* obs.setGauge("execution.iteration", ctx.iteration, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3763", tag: errorTag(err) })));
                  // Stage 5 quality fix: expose actual task success as a metric
                  // so the console exporter can display the correct status.
                  // Prior: exporter inferred success from phase health (always
                  // succeeded for verifier-rejected runs), causing the
                  // "Status: Success" lie when the task actually failed.
                  yield* obs.setGauge("execution.success", executionSucceeded ? 1 : 0, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:execution.success", tag: errorTag(err) })));

                  // Record model used (updated to actual model from LLM provider response)
                  const modelName = String(ctx.selectedModel ?? "unknown");
                  const provider = String(config.provider ?? "unknown");

                  yield* obs.incrementCounter("execution.model_name", 0, { model: modelName, provider, taskId: ctx.taskId })
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3770", tag: errorTag(err) })));
                }

                // ── Record entropy metrics for dashboard + Telemetry RunReport ──
                // Extracted to engine/finalize/telemetry-emit.ts (W24-B step 2).
                yield* emitTelemetryRunReport({
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
                });

                // ── Local Learning + Record Outcome ──
                // Extracted to engine/finalize/local-learning.ts (W24-B step 3).
                yield* runLocalLearning({
                  ctx,
                  task,
                  config,
                  terminatedByRaw,
                  errorsFromLoop,
                  entropyLog,
                  executionDurationMs,
                });

                // ── Run Finalization ──
                // Extracted to engine/finalize/run-finalize.ts (W24-B step 4).
                yield* finalizeRun({
                  ctx,
                  task,
                  config,
                  eb,
                  result,
                  executionStartMs,
                  entropyLog,
                  executionSucceeded,
                });

                return result;
              });

            // Initialize ObservableLogger
            //
            // Status-mode auto-activation uses an explicit opt-out signal so
            // the runtime never reads NODE_ENV (HS-01, 2026-05-20 sweep).
            // Tests/CI set `logging.disableStatusMode: true` or the
            // `REACTIVE_AGENTS_DISABLE_STATUS_MODE=true` env var.
            const statusModeDisabled =
              config.logging?.disableStatusMode === true ||
              process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE === "true";
            const isStatusMode =
              config.logging?.mode === "status" ||
              (config.logging?.mode !== "stream" &&
                Boolean(process.stdout.isTTY) &&
                !statusModeDisabled);

            const loggerConfig = {
              // In status mode the renderer owns all output; logger stays buffered
              live: isStatusMode ? false : (config.logging?.live ?? true),
              minLevel: config.logging?.minLevel,
            };
            const logger = yield* makeObservableLogger(loggerConfig);

            // Create renderer (no-op when not in status mode)
            const renderer = isStatusMode
              ? makeStatusRenderer(logger)
              : null;

            // Start status renderer before events flow
            if (renderer) yield* renderer.start();

            // Wrap in root observability span for the full execution trace
            // The cast is required because executeCore has service requirements from Effect.gen,
            // but they will be satisfied by Effect.provide(runtime) in the builder.
            const executeCoreRaw = executeCore().pipe(
              Effect.provideService(ObservableLogger, logger),
              Effect.tapError((err) => {
                // All RuntimeErrors extend Data.TaggedError which extends Error
                const asErr = err as unknown as Error & { cause?: Error };
                const message = asErr.message ?? String(err);
                const cause = asErr.cause instanceof Error ? asErr.cause : undefined;
                return logger.emit({
                  _tag: "error",
                  message,
                  error: cause ? { name: cause.name, message: cause.message, stack: cause.stack } : undefined,
                  timestamp: new Date(),
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4172", tag: errorTag(err) })));
              }),
              Effect.ensuring(Effect.sync(() => { renderer?.stop(); })),
            );

            // Effect built-in logger: silenced unconditionally because
            // ObservableLogger owns the structured-output channel. Internal
            // code paths should NEVER call Effect.log* directly — every event
            // goes through ObservableLogger.info/.error/.emit so consumers
            // (TTY renderer, OTLP exporter, JSONL trace) see a single ordered
            // stream. Silencing only in TTY produced CI/terminal divergence.
            //
            // Tradeoff (audit FIX-27): direct Effect.log* calls in our code
            // disappear here, which can mask bugs. The deeper fix is to wrap
            // ObservableLogger as a custom Effect Logger so Effect.log* events
            // become structured ObservableLogger events instead of being
            // silenced. Out of scope for W8; tracked in audit §11 #27.
            const executeCoreQuiet = executeCoreRaw.pipe(
              Effect.provide(Logger.replace(Logger.defaultLogger, Logger.none)),
            );

            // In status mode: additionally pipe think-stream chunks into the renderer
            const executeCoreWithLogger = isStatusMode && renderer
              ? Effect.locally(
                  executeCoreQuiet,
                  StreamingTextCallback,
                  (text: string) => Effect.sync(() => renderer.pushThinkChunk(text)),
                )
              : executeCoreQuiet;
            if (obs) {
              const taskResult = yield* obs.withSpan(
                "execution.run",
                executeCoreWithLogger as unknown as Effect.Effect<TaskResult, RuntimeErrors>,
                { taskId: task.id, agentId: task.agentId },
              );
              // Flush after the root span closes so spans are fully recorded
              yield* obs.flush().pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4198", tag: errorTag(err) })));
              return taskResult;
            }
            return yield* executeCoreWithLogger;
          }) as Effect.Effect<TaskResult, RuntimeErrors, any>
        ).pipe(
          // Always clean up running context
          Effect.ensuring(
            Ref.update(runningContexts, (m) => {
              const next = new Map(m);
              next.delete(task.id);
              return next;
            }),
          ),
        ) as Effect.Effect<TaskResult, RuntimeErrors>;

      // Wrap execute with per-execution timeout if configured
      if (config.executionTimeoutMs) {
        const timeoutMs = config.executionTimeoutMs;
        const _base = execute;
        execute = (task2: Task) =>
          _base(task2).pipe(
            Effect.timeoutFail({
              duration: Duration.millis(timeoutMs),
              onTimeout: () =>
                new ExecutionError({
                  message: `Execution timed out after ${timeoutMs}ms`,
                  taskId: task2.id,
                  phase: "think",
                }),
            }),
          );
      }

      return {
        execute,

        registerHook: (hook) => hookRegistry.register(hook).pipe(Effect.asVoid),

        getContext: (taskId) =>
          Ref.get(runningContexts).pipe(
            Effect.map((m) => m.get(taskId) ?? null),
          ),

        cancel: (taskId) =>
          Effect.gen(function* () {
            const running = yield* Ref.get(runningContexts);
            if (!running.has(taskId)) {
              return yield* Effect.fail(
                new ExecutionError({
                  message: `Task ${taskId} is not running`,
                  taskId,
                  phase: "complete",
                }),
              );
            }
            yield* Ref.update(cancelledTasks, (s) => new Set(s).add(taskId));
          }),

        executeStream: makeExecuteStream({ config, execute }),
      };
    }),
  );
