import { Effect, Context, Layer, Ref, Option, Queue, Stream as EStream, Duration, FiberRef, Logger } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "./types.js";
import {
  ExecutionError,
  GuardrailViolationError,
  KillSwitchTriggeredError,
  BehavioralContractViolationError,
  BudgetExceededError,
  MaxIterationsError,
  type RuntimeErrors,
} from "./errors.js";
import { LifecycleHookRegistry } from "./hooks.js";
import type { LifecycleHook } from "./types.js";

import type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
import { StreamingTextCallback } from "@reactive-agents/core";

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
import type { RunSummary } from "@reactive-agents/observability";
import { GuardrailService, KillSwitchService, BehavioralContractService } from "@reactive-agents/guardrails";
import { CostService } from "@reactive-agents/cost";
import { EventBus, EntropySensorService } from "@reactive-agents/core";
import type { AgentEvent, KernelStateLike } from "@reactive-agents/core";
import { synthesizeDebrief, type DebriefInput, type AgentDebrief } from "./debrief.js";
import { DebriefStoreService, PlanStoreService, ProceduralMemoryService } from "@reactive-agents/memory";
import { TelemetryClient as TelemetryClientImpl, classifyTaskCategory as classifyTaskCategoryFn, lookupModel as lookupModelFn, skillFragmentToProceduralEntry, loadObservations } from "@reactive-agents/reactive-intelligence";
import { resolveModelCalibration, resolveModelCalibrationAsync } from "./calibration-resolver.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { buildTrajectoryFingerprint, abstractifyToolName, firstConvergenceIteration, peakContextPressure, deriveTaskComplexity, deriveFailurePattern, deriveThoughtToActionRatio, entropyVariance, entropyOscillationCount, finalCompositeEntropy, entropyAreaUnderCurve } from "./telemetry-enrichment.js";
import { literalMentionRequired } from "./classifier-bypass.js";
import { resolveSynthesisConfigForStrategy } from "./synthesis-resolve.js";
import { formatTaskContextForChat } from "./chat.js";
import {
  persistRunObservation,
  buildRunObservation,
  countParallelTurnsFromLog,
} from "./observers/run-observer.js";
import { diffClassifierAccuracy } from "./classifier-accuracy.js";
import { isSubagentCall } from "./subagent-telemetry.js";
import { computeArgValidityRate } from "./arg-validity.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ─── Phase pipeline (W23 decomposition) ───
import { runGuardedPhase } from "./engine/pipeline.js";
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
import { resolveCalibration } from "./engine/phases/agent-loop/setup/calibration.js";
import { fetchToolsRegistry } from "./engine/phases/agent-loop/setup/tools-registry.js";
import { classifyTools } from "./engine/phases/agent-loop/setup/classifier.js";
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
      options?: { density?: StreamDensity },
    ) => Effect.Effect<EStream.Stream<AgentStreamEvent, Error>>;
  }
>() {}

// ─── Output Sanitization (safety net) ───

/**
 * Strip internal agent metadata from output before it reaches the user.
 * This is a safety net — strategies should sanitize their own output, but
 * this catches anything that slips through.
 */
function sanitizeOutput(text: string): string {
  if (!text || text.length === 0) return text;
  let result = text;
  // Strip <think>...</think> tags, but capture the last block as a fallback
  // in case the model (e.g. cogito) puts the entire answer inside <think>.
  const thinkBlocks: string[] = [];
  result = result.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, inner: string) => {
    thinkBlocks.push(inner.trim());
    return "";
  });
  // Strip "FINAL ANSWER:" prefix
  result = result.replace(/^FINAL ANSWER:\s*/i, "");
  // Strip internal step markers
  result = result.replace(/^\[(?:STEP \d+\/\d+|EXEC s\d+|SYNTHESIS|REFLECT \d+|SKIP s\d+|PATCH)\]\s*/gim, "");
  // Strip ReAct protocol prefixes at line start
  result = result.replace(/^(?:Thought|Action|Action Input|Observation):\s*/gim, "");
  // Strip tool call echo lines: "tool/name: {json}"
  result = result.replace(/^[\w\-]+\/[\w\-]+:\s*\{[^}]*\}\s*$/gm, "");
  // Strip lines that are just raw JSON with internal keys
  result = result.replace(/^\s*\{\s*"(?:recipient|toolName|callId|stepId|_tag)"[^}]*\}\s*$/gm, "");
  // Collapse multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();
  // Fallback: if stripping <think> blocks left nothing, use the last paragraph
  // of the last <think> block (models like cogito embed the answer inside thinking).
  if (!result && thinkBlocks.length > 0) {
    const lastBlock = thinkBlocks[thinkBlocks.length - 1] ?? "";
    const paragraphs = lastBlock.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
    result = paragraphs[paragraphs.length - 1] ?? lastBlock;
  }
  return result;
}

/**
 * Extract plain-text task description from task.input.
 * Handles both `{ question: "..." }` objects and raw strings.
 */
function extractTaskText(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const q = (input as Record<string, unknown>).question;
    if (typeof q === "string") return q;
  }
  return JSON.stringify(input);
}

/**
 * Derive per-tool call budgets from required tool quantities.
 *
 * Behavior:
 * - parallel mode (`parallelToolCalls !== false`): each required tool gets a
 *   budget of `minCalls + retryBuffer` where the buffer allows for exploratory
 *   combined searches, failed attempts, and guard-blocked calls that don't
 *   count as successful completions. Without this buffer the agent has zero
 *   room for recovery.
 * - sequential mode (`parallelToolCalls === false`): no auto per-tool budgets;
 *   execution follows the historical one-call-at-a-time loop behavior.
 */
export function buildAutoMaxCallsPerTool(input: {
  readonly parallelToolCallsEnabled: boolean;
  readonly requiredTools?: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
}): Readonly<Record<string, number>> {
  if (!input.parallelToolCallsEnabled) {
    return {};
  }

  const RETRY_BUFFER = 2;
  const requiredTools = new Set(input.requiredTools ?? []);
  const requiredToolQuantities = input.requiredToolQuantities ?? {};
  const autoMaxCallsPerTool: Record<string, number> = {};

  for (const toolName of requiredTools) {
    const minCalls = Math.max(1, requiredToolQuantities[toolName] ?? 1);
    autoMaxCallsPerTool[toolName] = minCalls + RETRY_BUFFER;
  }

  return autoMaxCallsPerTool;
}

// Deduplicates RI telemetry notice across runs within the same process
let _riTelemetryNoticeEmitted = false;

// `buildVerificationInput` and VERIFY_EVIDENCE_MAX_CHARS were hoisted to
// engine/phases/verify.ts (W23). Removing the unused private copies here.

// briefResolvedSkillsFromMetadata hoisted to engine/util.ts (W23 step 6a-3 prep)

// ExecutionReasoningResult and normalizeReasoningResult hoisted to engine/util.ts (W23 step 6a-2 prep)

// ─── Task Complexity Classification ───

type TaskComplexity = "trivial" | "moderate" | "complex";

function classifyComplexity(
  iteration: number,
  entropy: { composite: number } | undefined,
  toolCallCount: number,
  terminatedBy: string,
): TaskComplexity {
  if (iteration <= 1 && toolCallCount === 0 && terminatedBy !== "max_iterations") return "trivial";
  if (toolCallCount <= 2 && iteration <= 3 && (entropy ? entropy.composite < 0.4 : true)) return "moderate";
  return "complex";
}

// ─── allowedTools Mismatch Detection ───
// Hoisted to engine/util.ts (W23 step 4); re-export for backward compat
export { checkAllowedToolsMismatch } from "./engine/util.js";
import { normalizeReasoningResult, type ExecutionReasoningResult, briefResolvedSkillsFromMetadata } from "./engine/util.js";

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

      /**
       * Run a phase: fire before hooks, execute phase body, fire after hooks.
       * On error: fire on-error hooks, then propagate.
       */
      const runPhase = <E>(
        ctx: ExecutionContext,
        phase: ExecutionContext["phase"],
        body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
        eb?: EbLike | null,
      ): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
        Effect.gen(function* () {
          const ctxBefore = { ...ctx, phase };

          // Before hooks
          const ctxAfterBefore = yield* hookRegistry
            .run(phase, "before", ctxBefore)
            .pipe(Effect.catchAll(() => Effect.succeed(ctxBefore)));

          if (eb) {
            yield* eb.publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "before" })
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:387", tag: errorTag(err) })));
          }

          // Check cancellation
          const cancelled = yield* Ref.get(cancelledTasks);
          if (cancelled.has(ctx.taskId)) {
            if (eb) {
              yield* eb.publish({ _tag: "ExecutionCancelled", taskId: ctx.taskId })
                .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:395", tag: errorTag(err) })));
            }
            return yield* Effect.fail(
              new ExecutionError({
                message: `Task ${ctx.taskId} was cancelled`,
                taskId: ctx.taskId,
                phase,
              }),
            );
          }

          // Phase body
          const ctxAfterBody = yield* body(ctxAfterBefore).pipe(
            Effect.tapError((e) =>
              hookRegistry
                .run(phase, "on-error", {
                  ...ctxAfterBefore,
                  metadata: { ...ctxAfterBefore.metadata, error: e },
                })
                .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:414", tag: errorTag(err) }))),
            ),
          );

          // After hooks
          const ctxFinal = yield* hookRegistry
            .run(phase, "after", ctxAfterBody)
            .pipe(Effect.catchAll(() => Effect.succeed(ctxAfterBody)));

          if (eb) {
            yield* eb.publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "after" })
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:425", tag: errorTag(err) })));
          }

          return ctxFinal;
        });

      /**
       * H1 + Phase 0.2 + Phase 0.5: Observable phase wrapper
       * Wraps runPhase with observability span, phase event publishing, and metrics.
       */
      const runObservablePhase = <E>(
        obs: ObsLike | null,
        eb: EbLike | null,
        ctx: ExecutionContext,
        phase: ExecutionContext["phase"],
        body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
      ): Effect.Effect<ExecutionContext, E | RuntimeErrors> => {
        const startMs = performance.now();

        // Publish phase entered event (fire and forget)
        const publishEntered = eb
          ? eb.publish({ _tag: "ExecutionPhaseEntered", taskId: ctx.taskId, phase })
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:447", tag: errorTag(err) })))
          : Effect.void;

        const phaseEffect = runPhase(ctx, phase, body, eb).pipe(
          // After phase completes: emit metrics + phase completed event
          Effect.tap((_result) => {
            const durationMs = performance.now() - startMs;
            const sideEffects: Effect.Effect<void, never>[] = [];

            if (obs) {
              sideEffects.push(
                obs.incrementCounter("execution.phase.count", 1, { phase })
                  .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:459", tag: errorTag(err) }))),
              );
              sideEffects.push(
                obs.recordHistogram("execution.phase.duration_ms", durationMs, { phase })
                  .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:463", tag: errorTag(err) }))),
              );
            }
            if (eb) {
              sideEffects.push(
                eb.publish({ _tag: "ExecutionPhaseCompleted", taskId: ctx.taskId, phase, durationMs })
                  .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:469", tag: errorTag(err) }))),
              );
            }

            return Effect.all(sideEffects, { concurrency: "unbounded" }).pipe(Effect.asVoid);
          }),
        );

        const withEntered = publishEntered.pipe(Effect.zipRight(phaseEffect));

        if (!obs) return withEntered;

        return obs.withSpan(
          `execution.phase.${phase}`,
          withEntered.pipe(
            Effect.tap((result) =>
              obs.withSpan(`phase.${phase}.metrics`, Effect.void, {
                iteration: result.iteration,
                tokensUsed: result.tokensUsed,
                cost: result.cost,
              }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:489", tag: errorTag(err) }))),
            ),
          ),
          { taskId: ctx.taskId, agentId: ctx.agentId, phase },
        ) as Effect.Effect<ExecutionContext, E | RuntimeErrors>;
      };

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
            if (eb) {
              yield* eb.on("ReasoningStepCompleted", (event) =>
                Effect.sync(() => { _currentKernelIteration = event.step ?? _currentKernelIteration; }),
              );
              yield* eb.on("ToolCallCompleted", (event) =>
                Effect.sync(() => { toolCallLog.push({ toolName: event.toolName, durationMs: event.durationMs, success: event.success, iteration: _currentKernelIteration }); }),
              );
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
                const guardedPhase = <E>(
                  gCtx: ExecutionContext,
                  phase: ExecutionContext["phase"],
                  body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
                ): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
                  checkLifecycle(gCtx.taskId).pipe(
                    Effect.zipRight(runObservablePhase(obs, eb, gCtx, phase, body)),
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

                // ── Apply learned skills from procedural memory ──
                {
                  const mc = ctx.memoryContext as any;
                  if (mc?.activeWorkflows?.length > 0) {
                    const taskCat = classifyTaskCategoryFn(String(task.input));
                    const modelIdForSkill = String((config as any).model ?? config.provider ?? "unknown");
                    const matchingSkill = (mc.activeWorkflows as any[]).find(
                      (w: any) => w.tags?.includes(taskCat) && w.tags?.includes(modelIdForSkill),
                    );

                    if (matchingSkill?.pattern) {
                      try {
                        const fragment = JSON.parse(matchingSkill.pattern);
                        if (obs) {
                          yield* obs.info(`Applying learned skill: ${matchingSkill.name}`, {
                            convergenceIteration: fragment.convergenceIteration,
                            meanEntropy: fragment.meanComposite,
                            strategy: fragment.reasoningConfig?.strategy,
                            successRate: matchingSkill.successRate,
                            useCount: matchingSkill.useCount,
                          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:841", tag: errorTag(err) })));
                        }
                        // Store skill reference on context metadata for downstream use
                        ctx = { ...ctx, metadata: { ...ctx.metadata, appliedSkill: matchingSkill.name, appliedSkillId: matchingSkill.id, appliedSkillMeanEntropy: fragment.meanComposite } };
                      } catch {
                        // Invalid pattern — ignore
                      }
                    }
                  }
                }

                // ── Apply skills from SkillResolver (Living Intelligence System) ──
                {
                  const skillResolverOpt = yield* Effect.serviceOption(
                    Context.GenericTag<{
                      resolve: (params: { taskDescription: string; modelId: string; agentId: string }) => Effect.Effect<{ all: readonly any[]; autoActivate: readonly any[]; catalog: readonly any[] }, unknown>;
                      generateCatalogXml: (skills: readonly any[], options?: { catalogOnlyHint?: boolean }) => string;
                    }>("SkillResolverService"),
                  ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

                  if (skillResolverOpt._tag === "Some") {
                    const resolver = skillResolverOpt.value;
                    const resolved = yield* resolver.resolve({
                      taskDescription: extractTaskText(task.input),
                      modelId: String(ctx.selectedModel ?? config.defaultModel ?? "unknown"),
                      agentId: config.agentId,
                    }).pipe(Effect.catchAll(() => Effect.succeed({ all: [], autoActivate: [], catalog: [] })));

                    if (resolved.all.length > 0) {
                      const catalogXml = resolver.generateCatalogXml(resolved.catalog, {
                        catalogOnlyHint: true,
                      });
                      // Store resolved skills + catalog XML for strategy (memoryContext) and telemetry
                      ctx = {
                        ...ctx,
                        metadata: {
                          ...ctx.metadata,
                          resolvedSkills: resolved.all,
                          autoActivateSkills: resolved.autoActivate,
                          skillCatalogXml: catalogXml,
                        },
                      };

                      if (obs) {
                        yield* obs.info(`Skills resolved: ${resolved.all.length} total, ${resolved.autoActivate.length} auto-activate`).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:885", tag: errorTag(err) })));
                      }
                    }
                  }
                }

                // ── Log bootstrap summary ──
                if (obs && isNormal) {
                  const bootstrapMs = Date.now() - now.getTime();
                  const mc = ctx.memoryContext as any;
                  // MemoryBootstrapResult fields: semanticContext (string) + recentEpisodes (array)
                  const semanticLines = (mc?.semanticContext as string | undefined)
                    ?.split("\n").filter((l: string) => l.trim()).length ?? 0;
                  const episodicCount = (mc?.recentEpisodes as unknown[] | undefined)?.length ?? 0;
                  const memInfo = `${semanticLines} semantic lines, ${episodicCount} episodic`;
                  yield* obs.info(`◉ [bootstrap]  ${memInfo} | ${bootstrapMs}ms`)
                    .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:901", tag: errorTag(err) })));
                }

                // ── Experience tip injection (optional) ──
                if (config.enableExperienceLearning) {
                  const expOpt = yield* Effect.serviceOption(
                    Context.GenericTag<{
                      query: (desc: string, type: string, tier: string) => Effect.Effect<{ tips: readonly string[] }>;
                    }>("ExperienceStore"),
                  ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

                  if (expOpt._tag === "Some") {
                    const taskText = extractTaskText(task.input);
                    const tips = yield* expOpt.value
                      .query(taskText, task.type ?? "general", config.contextProfile?.tier ?? "mid")
                      .pipe(Effect.catchAll(() => Effect.succeed({ tips: [] as readonly string[] })));

                    if (tips.tips.length > 0) {
                      ctx = { ...ctx, metadata: { ...ctx.metadata, experienceTips: tips.tips } };
                      if (obs && isNormal) {
                        yield* obs.info(`◉ [experience]  ${tips.tips.length} tip(s) from prior runs`)
                          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:922", tag: errorTag(err) })));
                      }
                    }
                  }
                }

                // ── Publish MemorySnapshot so Cortex UI can display memory state ──
                if (eb) {
                  const mc = ctx.memoryContext as {
                    workingMemory?: Array<{ id?: string; content?: string }>;
                    recentEpisodes?: unknown[];
                    semanticContext?: string;
                  } | undefined;
                  const resolvedSkills = (ctx.metadata?.resolvedSkills as Array<{ name?: string; id?: string }> | undefined) ?? [];
                  const working = (mc?.workingMemory ?? []).map((item) => ({
                    key: item.id ?? "item",
                    preview: typeof item.content === "string"
                      ? item.content.slice(0, 120)
                      : String(item.content ?? ""),
                  }));
                  const semanticLines = (mc?.semanticContext ?? "")
                    .split("\n").filter((l: string) => l.trim()).length;
                  yield* eb.publish({
                    _tag: "MemorySnapshot" as const,
                    taskId: task.id,
                    iteration: 0,
                    working,
                    episodicCount: (mc?.recentEpisodes ?? []).length,
                    semanticCount: semanticLines,
                    skillsActive: resolvedSkills
                      .map((s) => s?.name ?? s?.id ?? "")
                      .filter(Boolean),
                  } as any).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:954", tag: errorTag(err) })));
                }

                // ── Phase 2: GUARDRAIL (optional) ── H2
                // Extracted to engine/phases/guardrail.ts (W23).
                ctx = yield* runGuardedPhase(guardrail, ctx, deps);

                // ── Phase 3: COST_ROUTE (optional) ── H2
                // Extracted to engine/phases/cost-route.ts (W23).
                ctx = yield* runGuardedPhase(costRoute, ctx, deps);

                if (config.enableCostTracking) {
                  // ── Budget pre-flight check: verify budget has room before reasoning ──
                  const budgetCostOpt = yield* Effect.serviceOption(CostService).pipe(
                    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                  );
                  if (budgetCostOpt._tag === "Some") {
                    yield* budgetCostOpt.value
                      .checkBudget(0, ctx.agentId, ctx.sessionId)
                      .pipe(
                        Effect.catchAll((budgetErr) => {
                          const msg = "message" in budgetErr ? String(budgetErr.message) : "Budget exceeded";
                          const budgetType = "budgetType" in budgetErr ? String(budgetErr.budgetType) : "unknown";
                          const limit = "limit" in budgetErr ? Number(budgetErr.limit) : 0;
                          const current = "current" in budgetErr ? Number(budgetErr.current) : 0;
                          return Effect.fail(
                            new BudgetExceededError({
                              message: msg,
                              taskId: ctx.taskId,
                              budgetType,
                              limit,
                              current,
                            }),
                          );
                        }),
                      );
                  }
                }

                // ── Phase 4: STRATEGY_SELECT ──
                // Extracted to engine/phases/strategy-select.ts (W23). Post-phase
                // work below (tool registry fetch, allowedTools mismatch warn,
                // log line) is orchestrator-level setup and stays inline.
                ctx = yield* runGuardedPhase(strategySelect, ctx, deps);

                // ── Tool registry fetch + allowedTools warn + strategy summary ──
                // Extracted to engine/phases/agent-loop/setup/tools-registry.ts (W23 step 4).
                const cachedToolDefs = yield* fetchToolsRegistry(config, ctx, obs, isNormal);
                // Used downstream by built-ins opt-in logic (lines ~1240, ~1286).
                const effectiveAllowedTools = config.allowedTools ?? [];

                // ── Phase 5: AGENT_LOOP ──

                // Resolve CalibrationMode → ModelCalibration | undefined once.
                // Placed here (before classifier gate) so classifierReliability is available.
                // Also shared by all three execute() call sites below.
                // Extracted to engine/phases/agent-loop/setup/calibration.ts (W23 step 4).
                const resolvedCalibration: ModelCalibration | undefined = yield* resolveCalibration(config);

                // ── LLM-based tool classification (required + relevant) ──
                // Extracted to engine/phases/agent-loop/setup/classifier.ts (W23 step 4b).
                // Decision tree: no classification / low-reliability literal-mention
                // fallback / LLM classify with hallucination demotion + sequential
                // clamp + relevant set merge.
                let { effectiveRequiredTools, effectiveRequiredToolQuantities, classifiedRelevantTools } =
                  yield* classifyTools({
                    config,
                    task,
                    cachedToolDefs,
                    resolvedCalibration,
                    obs,
                    isNormal,
                  });

                // ── Auto per-tool budget derived from required quantities ──
                // Parallel mode: use required minCalls as the budget floor so quotas
                // are satisfiable. Sequential mode: disable auto per-tool budgets.
                const autoMaxCallsPerTool = buildAutoMaxCallsPerTool({
                  parallelToolCallsEnabled: config.reasoningOptions?.parallelToolCalls !== false,
                  requiredTools: effectiveRequiredTools,
                  requiredToolQuantities: effectiveRequiredToolQuantities,
                });

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
                  let availableToolNames = cachedToolDefs.map((t: any) => t.name as string);
                  let availableToolSchemas = cachedToolDefs.map((t: any) => ({
                    name: t.name as string,
                    description: t.description as string,
                    parameters: (t.parameters ?? []).map((p: any) => ({
                      name: p.name as string,
                      type: p.type as string,
                      description: p.description as string,
                      required: Boolean(p.required),
                    })),
                  }));

                  // Snapshot the full unfiltered schemas for the completion guard
                  const allToolSchemas = [...availableToolSchemas];

                  // ── Tool schema preparation: built-ins opt-in + dynamic final-answer
                  // + allowedTools prompt filter + adaptive filter ──
                  // Body extracted to engine/phases/agent-loop/setup/tool-schemas.ts (W23 step 6a-6).
                  {
                    const prepared = yield* prepareReasoningToolSchemas({
                      config,
                      task,
                      availableToolSchemas,
                      availableToolNames,
                      effectiveAllowedTools,
                      effectiveRequiredTools,
                      classifiedRelevantTools,
                      resolvedCalibration,
                      obs,
                      isNormal,
                    });
                    availableToolSchemas = prepared.availableToolSchemas;
                    availableToolNames = prepared.availableToolNames;
                  }

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
                    // ── Kill switch check at top of each iteration ──
                    // This ensures pause/stop/terminate is honored before
                    // any expensive operations (LLM calls, tool execution).
                    yield* checkLifecycle(ctx.taskId);

                    // ── Behavioral contract: check iteration limit ──
                    if (config.enableBehavioralContracts) {
                      const bcOpt = yield* Effect.serviceOption(BehavioralContractService)
                        .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
                      if (bcOpt._tag === "Some") {
                        const violation = yield* bcOpt.value.checkIteration(ctx.iteration)
                          .pipe(Effect.catchAll(() => Effect.succeed(null)));
                        if (violation?.severity === "block") {
                          return yield* Effect.fail(new BehavioralContractViolationError({
                            message: violation.message, taskId: ctx.taskId,
                            rule: violation.rule, violation: violation.message,
                          }));
                        }
                      }
                    }

                    // ── Per-iteration budget check ──
                    if (config.enableCostTracking) {
                      const iterBudgetOpt = yield* Effect.serviceOption(CostService).pipe(
                        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                      );
                      if (iterBudgetOpt._tag === "Some") {
                        // Pass accumulated cost as estimatedCost so the enforcer checks
                        // whether current session/daily/monthly spend + this execution's
                        // cost so far exceeds any limit.
                        const budgetCheck = yield* iterBudgetOpt.value
                          .checkBudget(ctx.cost, ctx.agentId, ctx.sessionId)
                          .pipe(
                            Effect.map(() => true),
                            Effect.catchAll((budgetErr) => {
                              if (obs) {
                                const msg = "message" in budgetErr ? String(budgetErr.message) : "Budget exceeded";
                                return obs.info(`⚠ [budget] ${msg} — stopping execution`).pipe(
                                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2218", tag: errorTag(err) })),
                                  Effect.map(() => false),
                                );
                              }
                              return Effect.succeed(false);
                            }),
                          );
                        if (!budgetCheck) {
                          // Graceful stop — return what we have so far
                          ctx = {
                            ...ctx,
                            metadata: {
                              ...ctx.metadata,
                              budgetExceeded: true,
                              isComplete: true,
                              lastResponse: ctx.metadata.lastResponse ?? "Execution stopped: budget limit exceeded.",
                            },
                          };
                          isComplete = true;
                          break;
                        }
                      }
                    }

                    // Phase 0.2: Publish loop iteration event
                    if (eb) {
                      yield* eb.publish({
                        _tag: "ExecutionLoopIteration",
                        taskId: ctx.taskId,
                        iteration: ctx.iteration,
                      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2248", tag: errorTag(err) })));
                    }
                    // Phase 0.5: Track iteration gauge
                    if (obs) {
                      yield* obs.setGauge("execution.iteration", ctx.iteration, { taskId: ctx.taskId })
                        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2253", tag: errorTag(err) })));
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
                        }),
                    );

                    // Log thought phase for per-iteration progress visibility
                    yield* progressLogger.logIteration({
                      iteration: ctx.iteration,
                      maxIterations: ctx.maxIterations,
                      phase: "thought",
                      content: ctx.metadata.lastResponse as string,
                    }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2535", tag: errorTag(err) })));

                    // 5b. ACT (if tool calls present) — call real ToolService
                    // Body extracted to engine/phases/agent-loop/inline-act.ts (W23 step 6a-1a).
                    const pendingCalls =
                      (ctx.metadata.pendingToolCalls as unknown[]) ?? [];
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
                  if (obs) {
                    yield* obs.captureSnapshot(ctx.agentId, {
                      currentStrategy: ctx.selectedStrategy,
                      activeTools: ctx.availableTools ?? [],
                      tokenUsage: {
                        inputTokens: 0,
                        outputTokens: ctx.tokensUsed,
                        contextWindowUsed: ctx.messages.length,
                        contextWindowMax: 200_000,
                      },
                      costAccumulated: ctx.cost,
                    }).pipe(Effect.asVoid, Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2992", tag: errorTag(err) })));
                  }
                }

                // ── Phase 6: VERIFY (optional) ── H2
                // Extracted to engine/phases/verify.ts (W23). Skip predicate
                // gates on config.enableVerification.
                ctx = yield* runGuardedPhase(verify, ctx, deps);
                if (config.enableVerification) {
                  // Verification may be fast (heuristics) or involve extra LLM calls when useLLMTier is on;
                  // without this line it looks like verify "did nothing" in normal verbosity.
                  if (obs && isNormal) {
                    const vr = ctx.metadata.verificationResult as
                      | {
                          overallScore?: number;
                          passed?: boolean;
                          recommendation?: string;
                          layerResults?: ReadonlyArray<{ passed?: boolean; layerName?: string }>;
                        }
                      | undefined;
                    if (vr) {
                      const failedLayers = (vr.layerResults ?? [])
                        .filter((l) => l.passed === false)
                        .map((l) => l.layerName ?? "?")
                        .join(", ");
                      const failHint = failedLayers.length > 0 ? ` | failed layers: ${failedLayers}` : "";
                      yield* obs
                        .info(
                          `◉ [verify]     score=${(vr.overallScore ?? 0).toFixed(2)} passed=${String(vr.passed)} recommendation=${String(vr.recommendation ?? "?")}${failHint}`,
                        )
                        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3070", tag: errorTag(err) })));
                    } else {
                      yield* obs
                        .info(
                          "◉ [verify]     skipped — VerificationService not in runtime (check createRuntime / .withVerification wiring)",
                        )
                        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3076", tag: errorTag(err) })));
                    }
                  }
                }

                // ── Verification Quality Gate ──
                // If verification rejected the response, retry the think phase
                // with feedback so the agent can improve its answer.
                if (config.enableVerification) {
                  const vResult = ctx.metadata.verificationResult as
                    | { passed?: boolean; recommendation?: string; overallScore?: number; layerResults?: unknown[] }
                    | undefined;
                  const vRetryCount = (ctx.metadata.verificationRetryCount as number) ?? 0;
                  const maxVRetries = config.maxVerificationRetries ?? 1;

                  if (
                    vResult &&
                    vResult.passed === false &&
                    vResult.recommendation === "reject" &&
                    vRetryCount < maxVRetries
                  ) {
                    if (obs) {
                      yield* obs.info(
                        `⚠ [verify] Response rejected (score: ${vResult.overallScore?.toFixed(2) ?? "?"}) — retrying think phase (attempt ${vRetryCount + 1}/${maxVRetries})`,
                      ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3100", tag: errorTag(err) })));
                    }

                    // Build verification feedback for the next think iteration
                    const feedbackParts: string[] = [
                      `[Verification Feedback] Your previous response was rejected (score: ${vResult.overallScore?.toFixed(2) ?? "unknown"}).`,
                    ];
                    if (Array.isArray(vResult.layerResults)) {
                      for (const lr of vResult.layerResults as Array<{ layerName?: string; passed?: boolean; details?: string }>) {
                        if (lr.passed === false && lr.details) {
                          feedbackParts.push(`- ${lr.layerName ?? "check"}: ${lr.details}`);
                        }
                      }
                    }
                    feedbackParts.push("Please revise your answer to address these issues.");

                    // Inject feedback as a system message and reset completion state
                    ctx = {
                      ...ctx,
                      messages: [
                        ...ctx.messages,
                        { role: "user", content: feedbackParts.join("\n") },
                      ],
                      metadata: {
                        ...ctx.metadata,
                        isComplete: false,
                        verificationRetryCount: vRetryCount + 1,
                        verificationFeedback: feedbackParts.join("\n"),
                      },
                    };

                    // Re-run the think phase (single retry call).
                    //
                    // S3 (AUDIT-overhaul-2026 §16.4): when ReasoningService is wired,
                    // route the retry through it so it inherits state.steps[],
                    // entropy scoring, RI dispatcher, healing pipeline, FC tool
                    // execution, episodic memory bridge, and telemetry hooks. When
                    // reasoning is NOT wired (test mode / minimal layer), fall back
                    // to the original inline LLM call. The fallback is preserved
                    // byte-for-byte to keep verification-quality-gate.test.ts green
                    // (it pins llmCallCount === 2 and verifyCallCount === 2).
                    // Retry callback body extracted to engine/phases/agent-loop/verification-think-retry.ts (W23 step 6a-2).
                    ctx = yield* guardedPhase(ctx, "think", (c) =>
                      runVerificationThinkRetry(c, {
                        config,
                        task,
                        reasoningOpt,
                        taskCategory,
                        resolvedCalibration,
                        obs,
                        eb,
                      }),
                    );

                    // Re-run verification on the revised response (uses the
                    // same extracted phase value; W23).
                    ctx = yield* runGuardedPhase(verify, ctx, deps);

                    // If still rejected after retry, log warning and continue
                    const vResultAfterRetry = ctx.metadata.verificationResult as
                      | { passed?: boolean; recommendation?: string; overallScore?: number }
                      | undefined;
                    if (vResultAfterRetry && vResultAfterRetry.passed === false) {
                      if (obs) {
                        yield* obs.info(
                          `⚠ [verify] Response still rejected after ${vRetryCount + 1} retry(s) (score: ${vResultAfterRetry.overallScore?.toFixed(2) ?? "?"}) — proceeding anyway`,
                        ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3265", tag: errorTag(err) })));
                      }
                    }
                  }
                }

                // ── Phase 7: MEMORY_FLUSH ── H5
                // Compute task complexity to determine flush strategy
                {
                  const rrForComplexity = ctx.metadata.reasoningResult as { metadata?: { terminatedBy?: string; llmCalls?: number } } | undefined;
                  const terminatedByForComplexity = (rrForComplexity?.metadata?.terminatedBy ?? "end_turn") as string;
                  const latestEntropy = entropyLog.length > 0 ? entropyLog[entropyLog.length - 1] : undefined;
                  const complexity = classifyComplexity(
                    ctx.iteration,
                    latestEntropy,
                    toolCallLog.length,
                    terminatedByForComplexity,
                  );
                  // Store complexity on ctx metadata for later use in result assembly
                  ctx = { ...ctx, metadata: { ...ctx.metadata, taskComplexity: complexity } };

                  // Phase body extracted to engine/phases/memory-flush.ts (W23).
                  // Dispatch mode (trivial/moderate/complex) stays inline because
                  // it gates whether to skip / fork / run blocking, which is an
                  // orchestrator concern, not phase composition.
                  if (complexity === "trivial") {
                    ctx = { ...ctx, agentState: "flushing" as const };
                  } else if (complexity === "moderate") {
                    yield* Effect.forkDaemon(runGuardedPhase(memoryFlush, ctx, deps));
                  } else {
                    ctx = yield* runGuardedPhase(memoryFlush, ctx, deps);
                  }
                }

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
                const rr = ctx.metadata.reasoningResult as {
                  output?: unknown;
                  status?: string;
                  steps?: ReadonlyArray<{
                    type?: string;
                    content?: string;
                    metadata?: { observationResult?: { success?: boolean; toolName?: string } };
                  }>;
                  metadata?: { confidence?: number; strategyFallback?: boolean; terminatedBy?: string; finalAnswerCapture?: unknown; llmCalls?: number };
                } | undefined;
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

                // Publish FinalAnswerProduced event when final-answer tool is called
                if (terminatedByRaw === "final_answer_tool" && eb) {
                  const capture = rr?.metadata?.finalAnswerCapture as any;
                  yield* eb.publish({
                    _tag: "FinalAnswerProduced",
                    taskId: ctx.taskId,
                    strategy: ctx.selectedStrategy ?? "unknown",
                    answer: capture?.output ?? sanitizedOutput ?? "",
                    iteration: ctx.iteration,
                    totalTokens: ctx.tokensUsed,
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3550", tag: errorTag(err) })));
                }

                // Collect tool stats from ToolCallCompleted events (deterministic,
                // works across all strategies including plan-execute composite steps)
                const toolStatsMap = new Map<string, { calls: number; errors: number; totalDurationMs: number }>();
                for (const tc of toolCallLog) {
                  const existing = toolStatsMap.get(tc.toolName) ?? { calls: 0, errors: 0, totalDurationMs: 0 };
                  toolStatsMap.set(tc.toolName, {
                    calls: existing.calls + 1,
                    errors: existing.errors + (tc.success ? 0 : 1),
                    totalDurationMs: existing.totalDurationMs + tc.durationMs,
                  });
                }
                const toolCallHistory: DebriefInput["toolCallHistory"] = Array.from(toolStatsMap.entries()).map(
                  ([name, stat]) => ({
                    name,
                    calls: stat.calls,
                    errors: stat.errors,
                    avgDurationMs: stat.calls > 0 ? Math.round(stat.totalDurationMs / stat.calls) : 0,
                  }),
                );

                // Collect errors from tool call log + reasoning step observations
                const errorsFromLoop: string[] = [];
                for (const tc of toolCallLog) {
                  if (!tc.success) errorsFromLoop.push(`Tool ${tc.toolName} failed`);
                }
                const rrSteps = (ctx.metadata.reasoningSteps ?? []) as Array<{ type: string; content?: string }>;
                for (const step of rrSteps) {
                  if (step.type === "observation") {
                    const content = step.content ?? "";
                    const match = content.match(/\[Tool error: ([^\]]+)\]/);
                    if (match?.[1]) errorsFromLoop.push(match[1]);
                  }
                }

                const executionDurationMs = Date.now() - ctx.startedAt.getTime();

                const debriefInput: DebriefInput = {
                  taskPrompt: extractTaskText(task.input),
                  agentId: ctx.agentId,
                  taskId: ctx.taskId,
                  terminatedBy: terminatedByRaw,
                  finalAnswerCapture: rr?.metadata?.finalAnswerCapture as any,
                  finalOutputText: hasSubstantiveOutput ? outputForSuccess : undefined,
                  toolCallHistory,
                  errorsFromLoop,
                  metrics: {
                    tokens: ctx.tokensUsed,
                    duration: executionDurationMs,
                    iterations: ctx.iteration,
                    cost: ctx.cost,
                  },
                };

                // Synthesize debrief (best-effort, only on the reasoning path with memory enabled).
                // Gated on BOTH: rr !== undefined (reasoning path was used) AND config.enableMemory
                // (user opted in with .withMemory()). Skipped otherwise to avoid injecting extra
                // LLM calls in direct-LLM path tests and non-memory configurations.
                // Also requires LLMService to be available in context — use serviceOption to check.
                // Proportional: skip debrief for trivial and moderate tasks (only run for complex).
                const debrief: AgentDebrief | undefined = yield* (rr !== undefined && config.enableMemory
                  ? Effect.serviceOption(
                      Context.GenericTag<{ complete: (req: unknown) => Effect.Effect<unknown> }>("LLMService"),
                    ).pipe(
                      Effect.flatMap((llmOpt) => {
                        if (llmOpt._tag !== "Some") return Effect.succeed(undefined as AgentDebrief | undefined);
                        return synthesizeDebrief(debriefInput).pipe(
                          Effect.flatMap((d) => {
                            const debrief = d as AgentDebrief;
                            if (!eb) {
                              return Effect.succeed(debrief);
                            }
                            return eb.publish({
                              _tag: "DebriefCompleted",
                              taskId: debriefInput.taskId,
                              agentId: debriefInput.agentId,
                              debrief,
                            }).pipe(
                              Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3630", tag: errorTag(err) })),
                              Effect.as(debrief),
                            );
                          }),
                          Effect.catchAll(() => Effect.succeed(undefined as AgentDebrief | undefined)),
                        );
                      }),
                      Effect.catchAll(() => Effect.succeed(undefined as AgentDebrief | undefined)),
                    )
                  : Effect.succeed(undefined as AgentDebrief | undefined));

                // Persist debrief if DebriefStoreService is available
                if (debrief !== undefined) {
                  yield* Effect.serviceOption(DebriefStoreService).pipe(
                    Effect.flatMap((storeOpt) => {
                      if (storeOpt._tag !== "Some") return Effect.void;
                      return storeOpt.value.save({
                        taskId: ctx.taskId,
                        agentId: ctx.agentId,
                        taskPrompt: extractTaskText(task.input),
                        terminatedBy: terminatedByRaw,
                        output: String(sanitizedOutput ?? ""),
                        outputFormat: "text",
                        debrief: debrief as any,
                      }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3654", tag: errorTag(err) })));
                    }),
                    Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3656", tag: errorTag(err) })),
                  );
                }

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
                    stepsCount: (ctx.metadata.stepsCount as number | undefined) ?? ctx.iteration,
                    iterations: ctx.iteration,
                    // Forward reasoning steps so chat() can access tool results and analysis.
                    // Cast needed: reasoningSteps is an internal field not in the public TaskResult type.
                    ...(ctx.metadata.reasoningSteps ? { reasoningSteps: ctx.metadata.reasoningSteps } as any : {}),
                    ...(rr?.metadata?.confidence !== undefined ? {
                      confidence: (rr.metadata.confidence >= 0.7
                        ? "high"
                        : rr.metadata.confidence >= 0.4
                          ? "medium"
                          : "low") as "high" | "medium" | "low",
                    } : {}),
                    ...(rr?.metadata?.strategyFallback === true ? { strategyFallback: true } : {}),
                    ...(ctx.metadata.budgetExceeded ? { budgetExceeded: true } : {}),
                    complexity: (ctx.metadata.taskComplexity as TaskComplexity | undefined) ?? classifyComplexity(
                      ctx.iteration,
                      entropyLog.length > 0 ? entropyLog[entropyLog.length - 1] : undefined,
                      toolCallLog.length,
                      terminatedByRaw,
                    ),
                    // rr.metadata has llmCalls from reasoning path; ctx.metadata from direct-LLM path
                    llmCalls: rr?.metadata?.llmCalls ?? (ctx.metadata.llmCalls as number | undefined) ?? 0,
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

                // ── Record entropy metrics for dashboard ──
                if (obs && entropyLog.length > 0) {
                  for (const pt of entropyLog) {
                    yield* obs.setGauge("entropy.composite", pt.composite, {
                      taskId: ctx.taskId,
                      iteration: String(pt.iteration),
                      shape: pt.trajectory.shape,
                      confidence: pt.confidence,
                    }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3781", tag: errorTag(err) })));
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

                // Scoped variable to pass LearningResult from the RI block to the outcome block.
                // ctx.metadata is observable agent context — never use it as a private scratchpad.
                let lastLearningResult: import("@reactive-agents/reactive-intelligence").LearningResult | undefined;

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
                          temperature: (config as any).temperature ?? 0.7,
                          maxIterations: config.maxIterations ?? 10,
                          provider: String(ctx.provider ?? config.provider ?? "unknown"),
                          skillsActivated: (ctx.metadata as any)?.resolvedSkills?.filter((s: any) => s.confidence === "expert").map((s: any) => s.name) ?? [],
                          convergenceIteration: entropyLog.length > 0
                            ? entropyLog.findIndex((e: any) => e.trajectory?.shape === "converging")
                            : null,
                          toolCallSequence: (ctx.metadata as any)?.toolCallSequence ?? [],
                        });

                        // Pass learning result to the outcome block via a scoped variable.
                        lastLearningResult = learningResult;

                        // Persist synthesized skill fragment to procedural memory
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
                                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3977", tag: errorTag(err) })),
                              );
                            }),
                            Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3980", tag: errorTag(err) })),
                          );
                        }
                      });
                    }),
                    Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:3985", tag: errorTag(err) })),
                  );
                }

                // ── Record outcome for applied skill ──
                {
                  const appliedSkillId = (ctx.metadata as any)?.appliedSkillId;
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
                            Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4003", tag: errorTag(err) })),
                          );

                          // Change 3: re-store improved fragment when entropy improved on a full success
                          if (config.enableReactiveIntelligence) {
                            const learningResultRef = lastLearningResult;
                            const appliedSkillMeanEntropy = (ctx.metadata as any)?.appliedSkillMeanEntropy as number | undefined;
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
                                Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4025", tag: errorTag(err) })),
                              );
                            }
                          }
                        });
                      }),
                      Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4031", tag: errorTag(err) })),
                    );
                  }
                }

                // Phase 0.2: Lifecycle completion events (aligned with TaskResult.success)
                if (eb) {
                  yield* eb.publish({
                    _tag: "AgentCompleted",
                    taskId: ctx.taskId,
                    agentId: config.agentId,
                    success: executionSucceeded,
                    totalIterations: ctx.iteration,
                    totalTokens: ctx.tokensUsed,
                    durationMs: Date.now() - executionStartMs,
                    ...(!executionSucceeded && result.error ? { error: result.error } : {}),
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4047", tag: errorTag(err) })));
                  yield* eb.publish({
                    _tag: "TaskCompleted",
                    taskId: task.id,
                    success: executionSucceeded,
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4052", tag: errorTag(err) })));
                }

                // Attach entropy trace to result metadata for dashboard consumption
                if (entropyLog.length > 0) {
                  (result.metadata as any).entropyTrace = entropyLog;
                }

                // Emit token and cost metrics for status renderer
                yield* Effect.serviceOption(ObservableLogger).pipe(
                  Effect.tap((loggerOpt) => {
                    if (loggerOpt._tag === "Some") {
                      return Effect.all([
                        loggerOpt.value.emit({
                          _tag: "metric",
                          name: "tokens_used",
                          value: result.metadata.tokensUsed ?? 0,
                          unit: "tokens",
                          timestamp: new Date(),
                        }),
                        loggerOpt.value.emit({
                          _tag: "metric",
                          name: "cost_usd",
                          value: result.metadata.cost ?? 0,
                          unit: "usd",
                          timestamp: new Date(),
                        }),
                      ], { concurrency: "unbounded" }).pipe(Effect.asVoid);
                    }
                    return Effect.void;
                  }),
                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4083", tag: errorTag(err) })),
                );

                // Emit completion event
                const executionDuration = Date.now() - executionStartMs;
                yield* Effect.serviceOption(ObservableLogger).pipe(
                  Effect.tap((loggerOpt) => {
                    if (loggerOpt._tag === "Some") {
                      return loggerOpt.value.emit({
                        _tag: "completion",
                        success: result.success === true,
                        summary: `Task ${result.success ? "completed" : "failed"} in ${(executionDuration / 1000).toFixed(1)}s with ${result.metadata.tokensUsed} tokens`,
                        timestamp: new Date(),
                      });
                    }
                    return Effect.void;
                  }),
                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4100", tag: errorTag(err) })),
                );

                // Handle non-live mode output
                const loggerConfig = config.logging ?? { live: true };
                if (!loggerConfig.live) {
                  yield* Effect.serviceOption(ObservableLogger).pipe(
                    Effect.tap((loggerOpt) => {
                      if (loggerOpt._tag === "Some") {
                        return loggerOpt.value.flush().pipe(
                          Effect.tap((summary: RunSummary) =>
                            Effect.gen(function* () {
                              console.log("\n═══ Run Summary ═══");
                              console.log(`Status:   ${summary.status}`);
                              console.log(`Duration: ${(summary.duration / 1000).toFixed(1)}s`);
                              console.log(`Tokens:   ${summary.totalTokens}`);
                              if (summary.warnings.length > 0) {
                                console.log(`Warnings: ${summary.warnings.length}`);
                              }
                              if (summary.errors.length > 0) {
                                console.log(`Errors: ${summary.errors.length}`);
                              }
                            }),
                          ),
                        );
                      }
                      return Effect.void;
                    }),
                    Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4128", tag: errorTag(err) })),
                  );
                }

                return result;
              });

            // Initialize ObservableLogger
            const isStatusMode =
              config.logging?.mode === "status" ||
              (config.logging?.mode !== "stream" &&
                Boolean(process.stdout.isTTY) &&
                process.env.NODE_ENV !== "test");

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

        executeStream: (task, options) =>
          Effect.gen(function* () {
            const queue = yield* Queue.unbounded<AgentStreamEvent>();
            const density = options?.density ?? config.streamDensity ?? "tokens";
            const startMs = Date.now();

            // Acquire EventBus optionally
            const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
              Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
            );
            const eb: EbLike | null = ebOpt._tag === "Some" ? ebOpt.value : null;

            // Fire AgentStreamStarted
            if (eb) {
              yield* eb.publish({
                _tag: "AgentStreamStarted",
                taskId: String(task.id),
                agentId: config.agentId,
                density,
                timestamp: startMs,
              } as AgentEvent).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4277", tag: errorTag(err) })));
            }

            // Subscribe to ReasoningIterationProgress events — push them as IterationProgress stream events
            if (eb) {
              yield* eb.on("ReasoningIterationProgress", (event) =>
                Effect.gen(function* () {
                  const eventTaskId = String((event as { taskId?: string }).taskId ?? "");
                  if (eventTaskId !== String(task.id)) {
                    return;
                  }
                  yield* Queue.offer(queue, {
                    _tag: "IterationProgress",
                    iteration: event.iteration,
                    maxIterations: event.maxIterations,
                    toolsCalledThisStep: event.toolsThisStep,
                    status: `iteration ${event.iteration}/${event.maxIterations}`,
                  } as AgentStreamEvent).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4294", tag: errorTag(err) })));
                }),
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4296", tag: errorTag(err) })));
            }

            // Full density: emit live thought text for each reasoning step.
            if (eb && density === "full") {
              yield* eb.on("ReasoningStepCompleted", (event) =>
                Effect.gen(function* () {
                  const eventTaskId = String((event as { taskId?: string }).taskId ?? "");
                  if (eventTaskId !== String(task.id)) {
                    return;
                  }
                  const thought =
                    typeof (event as { thought?: unknown }).thought === "string"
                      ? ((event as { thought?: string }).thought ?? "").trim()
                      : "";
                  if (thought.length === 0) {
                    return;
                  }
                  const iteration =
                    typeof (event as { step?: unknown }).step === "number"
                      ? ((event as { step?: number }).step ?? 0)
                      : 0;
                  yield* Queue.offer(queue, {
                    _tag: "ThoughtEmitted",
                    content: thought,
                    iteration,
                  } as AgentStreamEvent).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4322", tag: errorTag(err) })));
                }),
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4324", tag: errorTag(err) })));
            }

            // Set the streaming callback inside the daemon so the FiberRef is
            // available to the reasoning kernel. forkDaemon creates a root fiber
            // that does NOT inherit FiberRef values from Effect.locally — the only
            // reliable way is FiberRef.set as the first step inside the fork.
            const streamCallback = (text: string) =>
              Queue.offer(queue, { _tag: "TextDelta", text }).pipe(
                Effect.map(() => {}),
              );

            yield* FiberRef.set(StreamingTextCallback, streamCallback).pipe(
              Effect.andThen(execute(task)),
              Effect.tap((taskResult) => {
                const debriefToolsUsed = (taskResult as any).debrief?.toolsUsed as Array<{ name: string; calls: number; successRate: number }> | undefined;
                const toolSummary = debriefToolsUsed && debriefToolsUsed.length > 0
                  ? debriefToolsUsed.map((t) => ({ name: t.name, calls: t.calls, avgMs: 0 }))
                  : [];
                const completedEvent: AgentStreamEvent = {
                  _tag: "StreamCompleted",
                  output: String((taskResult as any).output ?? ""),
                  metadata: (taskResult as any).metadata ?? {},
                  taskId: String(task.id),
                  agentId: String(task.agentId),
                  ...(toolSummary.length > 0 ? { toolSummary } : {}),
                };
                const offer = Queue.offer(queue, completedEvent);
                if (!eb) return offer;
                return offer.pipe(
                  Effect.tap(() =>
                    eb.publish({
                      _tag: "AgentStreamCompleted",
                      taskId: String(task.id),
                      agentId: config.agentId,
                      success: true,
                      durationMs: Date.now() - startMs,
                    } as AgentEvent).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4361", tag: errorTag(err) }))),
                  ),
                );
              }),
              Effect.catchAll((err: unknown) => {
                const cause =
                  typeof err === "object" && err !== null && "message" in err
                    ? String((err as any).message)
                    : String(err);
                const errorEvent: AgentStreamEvent = { _tag: "StreamError", cause };
                const offer = Queue.offer(queue, errorEvent);
                if (!eb) return offer;
                return offer.pipe(
                  Effect.tap(() =>
                    eb.publish({
                      _tag: "AgentStreamCompleted",
                      taskId: String(task.id),
                      agentId: config.agentId,
                      success: false,
                      durationMs: Date.now() - startMs,
                    } as AgentEvent).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4381", tag: errorTag(err) }))),
                  ),
                );
              }),
              Effect.forkDaemon,
            );

            // Stream reads from queue, stops after terminal event.
            return EStream.unfoldEffect(false as boolean, (done) => {
              if (done) return Effect.succeed(Option.none());
              return Queue.take(queue).pipe(
                Effect.map((event) => {
                  const isTerminal =
                    event._tag === "StreamCompleted" ||
                    event._tag === "StreamError" ||
                    event._tag === "StreamCancelled";
                  return Option.some([event, isTerminal] as const);
                }),
              );
            });
          }),
      };
    }),
  );
