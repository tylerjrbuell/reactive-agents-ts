import { Effect, Context, Layer, Ref, Option, Queue, Stream as EStream, Duration } from "effect";
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
import { inferRequiredTools, classifyToolRelevance, filterToolsByRelevance } from "@reactive-agents/reasoning";
import { ToolService } from "@reactive-agents/tools";
import { ObservabilityService, createProgressLogger } from "@reactive-agents/observability";
import { GuardrailService, KillSwitchService, BehavioralContractService } from "@reactive-agents/guardrails";
import { VerificationService } from "@reactive-agents/verification";
import { CostService } from "@reactive-agents/cost";
import { EventBus, EntropySensorService } from "@reactive-agents/core";
import type { AgentEvent, KernelStateLike } from "@reactive-agents/core";
import { synthesizeDebrief, type DebriefInput, type AgentDebrief } from "./debrief.js";
import { DebriefStoreService, PlanStoreService } from "@reactive-agents/memory";
import { TelemetryClient as TelemetryClientImpl, classifyTaskCategory as classifyTaskCategoryFn, lookupModel as lookupModelFn } from "@reactive-agents/reactive-intelligence";
import { recommendStrategyForTier } from "@reactive-agents/llm-provider";
import { buildTrajectoryFingerprint, abstractifyToolName, firstConvergenceIteration, peakContextPressure, deriveTaskComplexity, deriveFailurePattern, deriveThoughtToActionRatio } from "./telemetry-enrichment.js";
import { resolveSynthesisConfigForStrategy } from "./synthesis-resolve.js";

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
              .pipe(Effect.catchAll(() => Effect.void));
          }

          // Check cancellation
          const cancelled = yield* Ref.get(cancelledTasks);
          if (cancelled.has(ctx.taskId)) {
            if (eb) {
              yield* eb.publish({ _tag: "ExecutionCancelled", taskId: ctx.taskId })
                .pipe(Effect.catchAll(() => Effect.void));
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
                .pipe(Effect.catchAll(() => Effect.void)),
            ),
          );

          // After hooks
          const ctxFinal = yield* hookRegistry
            .run(phase, "after", ctxAfterBody)
            .pipe(Effect.catchAll(() => Effect.succeed(ctxAfterBody)));

          if (eb) {
            yield* eb.publish({ _tag: "ExecutionHookFired", taskId: ctx.taskId, phase: String(phase), timing: "after" })
              .pipe(Effect.catchAll(() => Effect.void));
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
              .pipe(Effect.catchAll(() => Effect.void))
          : Effect.void;

        const phaseEffect = runPhase(ctx, phase, body, eb).pipe(
          // After phase completes: emit metrics + phase completed event
          Effect.tap((_result) => {
            const durationMs = performance.now() - startMs;
            const sideEffects: Effect.Effect<void, never>[] = [];

            if (obs) {
              sideEffects.push(
                obs.incrementCounter("execution.phase.count", 1, { phase })
                  .pipe(Effect.catchAll(() => Effect.void)),
              );
              sideEffects.push(
                obs.recordHistogram("execution.phase.duration_ms", durationMs, { phase })
                  .pipe(Effect.catchAll(() => Effect.void)),
              );
            }
            if (eb) {
              sideEffects.push(
                eb.publish({ _tag: "ExecutionPhaseCompleted", taskId: ctx.taskId, phase, durationMs })
                  .pipe(Effect.catchAll(() => Effect.void)),
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
              }).pipe(Effect.catchAll(() => Effect.void)),
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
            const toolCallLog: { toolName: string; durationMs: number; success: boolean }[] = [];
            if (eb) {
              yield* eb.on("ToolCallCompleted", (event) =>
                Effect.sync(() => { toolCallLog.push({ toolName: event.toolName, durationMs: event.durationMs, success: event.success }); }),
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
                  }).pipe(Effect.catchAll(() => Effect.void)),
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

                // ── Lifecycle guard helper ──
                const checkLifecycle = (taskId: string): Effect.Effect<void, RuntimeErrors> =>
                  Effect.gen(function* () {
                    if (!ks) return;
                    const status = yield* ks.waitIfPaused(config.agentId, taskId)
                      .pipe(Effect.catchAll(() => Effect.succeed("ok" as const)));
                    if (status === "stopping") {
                      if (eb) yield* eb.publish({ _tag: "AgentStopping", agentId: config.agentId,
                        taskId, reason: "stop() requested" }).pipe(Effect.catchAll(() => Effect.void));
                      if (eb) yield* eb.publish({ _tag: "AgentStopped", agentId: config.agentId,
                        taskId, reason: "stop() requested" }).pipe(Effect.catchAll(() => Effect.void));
                      return yield* Effect.fail(new KillSwitchTriggeredError({
                        message: `Agent ${config.agentId} stopping gracefully`,
                        taskId, agentId: config.agentId, reason: "stop() requested",
                      }));
                    }
                    const ksStatus = (yield* ks.isTriggered(config.agentId)
                      .pipe(Effect.catchAll(() => Effect.succeed({ triggered: false })))) as { triggered: boolean; reason?: string };
                    if (ksStatus.triggered) {
                      if (eb) yield* eb.publish({ _tag: "AgentTerminated", agentId: config.agentId,
                        taskId, reason: ksStatus.reason ?? "terminated" }).pipe(Effect.catchAll(() => Effect.void));
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
                  }).pipe(Effect.catchAll(() => Effect.void));
                }

                if (eb) {
                  yield* eb.publish({
                    _tag: "AgentStarted",
                    taskId: ctx.taskId,
                    agentId: config.agentId,
                    provider: String(ctx.provider ?? "unknown"),
                    model: String(ctx.selectedModel ?? "unknown"),
                    timestamp: executionStartMs,
                  }).pipe(Effect.catchAll(() => Effect.void));
                }

                // ── Phase 1: BOOTSTRAP ──
                ctx = yield* guardedPhase(ctx, "bootstrap", (c) =>
                  Effect.gen(function* () {
                    const memoryContext = yield* Effect.serviceOption(
                      Context.GenericTag<{
                        bootstrap: (id: string) => Effect.Effect<unknown>;
                      }>("MemoryService"),
                    ).pipe(
                      Effect.flatMap((opt) =>
                        opt._tag === "Some"
                          ? opt.value
                              .bootstrap(c.agentId)
                              .pipe(Effect.map((mc) => mc))
                          : Effect.succeed(undefined),
                      ),
                      Effect.catchAll(() => Effect.succeed(undefined)),
                    );

                    return {
                      ...c,
                      agentState: "running" as const,
                      memoryContext,
                    };
                  }),
                );

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
                          }).pipe(Effect.catchAll(() => Effect.void));
                        }
                        // Store skill reference on context metadata for downstream use
                        ctx = { ...ctx, metadata: { ...ctx.metadata, appliedSkill: matchingSkill.name } };
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
                      // Store resolved skills on context metadata
                      ctx = { ...ctx, metadata: { ...ctx.metadata, resolvedSkills: resolved.all, autoActivateSkills: resolved.autoActivate } };

                      if (obs) {
                        yield* obs.info(`Skills resolved: ${resolved.all.length} total, ${resolved.autoActivate.length} auto-activate`).pipe(Effect.catchAll(() => Effect.void));
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
                    .pipe(Effect.catchAll(() => Effect.void));
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
                          .pipe(Effect.catchAll(() => Effect.void));
                      }
                    }
                  }
                }

                // ── Phase 2: GUARDRAIL (optional) ── H2
                if (config.enableGuardrails) {
                  ctx = yield* guardedPhase(ctx, "guardrail", (c) =>
                    Effect.gen(function* () {
                      const guardrailOpt = yield* Effect.serviceOption(
                        GuardrailService,
                      ).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({ _tag: "None" as const }),
                        ),
                      );

                      if (guardrailOpt._tag === "Some") {
                        const inputText = extractTaskText(task.input);
                        const result = yield* guardrailOpt.value
                          .check(inputText)
                          .pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({
                                passed: true,
                                violations: [],
                                score: 1,
                                checkedAt: new Date(),
                              }),
                            ),
                          );

                        if (!result.passed) {
                          const violationSummary = result.violations
                            .map((v: any) => `${v.type}: ${v.message}`)
                            .join("; ");
                          if (eb) {
                            yield* eb.publish({
                              _tag: "GuardrailViolationDetected",
                              taskId: c.taskId,
                              violations: result.violations.map((v: any) => `${v.type}: ${v.message}`),
                              score: result.score,
                              blocked: true,
                            }).pipe(Effect.catchAll(() => Effect.void));
                          }
                          return yield* Effect.fail(
                            new GuardrailViolationError({
                              message: `Input guardrail check failed: ${violationSummary}`,
                              taskId: c.taskId,
                              violation: violationSummary,
                            }),
                          );
                        }

                        return {
                          ...c,
                          metadata: { ...c.metadata, guardrailScore: result.score },
                        };
                      }

                      return c;
                    }),
                  );
                }

                // ── Phase 3: COST_ROUTE (optional) ── H2
                if (config.enableCostTracking) {
                  ctx = yield* guardedPhase(ctx, "cost-route", (c) =>
                    Effect.gen(function* () {
                      const costOpt = yield* Effect.serviceOption(CostService).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({ _tag: "None" as const }),
                        ),
                      );

                      if (costOpt._tag === "Some") {
                        const taskDescription = extractTaskText(task.input);
                        const modelConfig = yield* costOpt.value
                          .routeToModel(taskDescription)
                          .pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({ model: config.defaultModel }),
                            ),
                          );
                        // The complexity router returns Anthropic model names (e.g. claude-haiku-*).
                        // Only apply the routed model when actually using Anthropic; for other
                        // providers (Ollama, OpenAI, etc.) use the configured default model.
                        const routedModel = (modelConfig as any).model as string | undefined;
                        const useRoutedModel =
                          config.provider === "anthropic" && !!routedModel;
                        return {
                          ...c,
                          selectedModel: useRoutedModel
                            ? routedModel
                            : config.defaultModel,
                        };
                      }

                      return { ...c, selectedModel: config.defaultModel };
                    }),
                  );

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
                ctx = yield* guardedPhase(ctx, "strategy-select", (c) =>
                  Effect.gen(function* () {
                    const selectorOpt = yield* Effect.serviceOption(
                      Context.GenericTag<{
                        select: (
                          selCtx: unknown,
                          memCtx: unknown,
                        ) => Effect.Effect<string>;
                      }>("StrategySelector"),
                    );
                    const strategy =
                      selectorOpt._tag === "Some"
                        ? yield* selectorOpt.value
                            .select(
                              {
                                taskDescription: extractTaskText(task.input),
                                taskType: task.type,
                                complexity: 0.5,
                                urgency: 0.5,
                              },
                              c.memoryContext,
                            )
                            .pipe(Effect.catchAll(() => Effect.succeed(config.defaultStrategy ?? "reactive")))
                        : (config.defaultStrategy ?? "reactive");
                    return { ...c, selectedStrategy: strategy };
                  }),
                );

                // ── Single tool registry fetch (reused for logging, classification, and reasoning) ──
                const cachedToolDefs = yield* Effect.serviceOption(ToolService).pipe(
                  Effect.flatMap((opt) =>
                    opt._tag === "Some"
                      ? opt.value.listTools()
                      : Effect.succeed([] as readonly any[]),
                  ),
                  Effect.catchAll(() => Effect.succeed([] as readonly any[])),
                );

                // ── Log strategy-select summary ──
                // Only show capability tools — hide framework infrastructure (conductor tools,
                // final-answer, context-status, etc.) so the list reflects what the agent does,
                // not how the framework works internally.
                if (obs && isNormal) {
                  const FRAMEWORK_TOOLS = new Set([
                    "final-answer", "task-complete", "context-status",
                    "brief", "pulse", "find", "recall",
                    "activate-skill", "get-skill-section", "context-task",
                  ]);
                  const toolNames = cachedToolDefs
                    .map((t: any) => t.name as string)
                    .filter((n) => !FRAMEWORK_TOOLS.has(n))
                    .join(", ");
                  const toolsInfo = toolNames ? ` | tools: ${toolNames}` : "";
                  yield* obs.info(`◉ [strategy]   ${ctx.selectedStrategy ?? "reactive"}${toolsInfo}`)
                    .pipe(Effect.catchAll(() => Effect.void));
                }

                // ── Phase 5: AGENT_LOOP ──

                // ── LLM-based tool classification (required + relevant) ──
                // Single structured-output call replaces both heuristic required-tools
                // inference and adaptive tool filtering. Semantic understanding > keywords.
                let effectiveRequiredTools = config.requiredTools?.tools;
                let classifiedRelevantTools: readonly string[] | undefined;
                const needsClassification =
                  (config.requiredTools?.adaptive && !config.requiredTools?.tools?.length) ||
                  config.adaptiveToolFiltering;
                if (needsClassification) {
                  const classifyResult = yield* classifyToolRelevance({
                    taskDescription: extractTaskText(task.input),
                    availableTools: cachedToolDefs.map((t: any) => ({
                      name: t.name as string,
                      description: (t.description ?? "") as string,
                      parameters: ((t.parameters ?? []) as any[]).map((p: any) => ({
                        name: p.name as string,
                        type: (p.type ?? "string") as string,
                        description: (p.description ?? "") as string,
                        required: Boolean(p.required),
                      })),
                    })),
                    systemPrompt: config.systemPrompt,
                  }).pipe(
                    // Degrade gracefully if LLM call fails — empty arrays = no filtering
                    Effect.catchAll(() => Effect.succeed({ required: [] as readonly string[], relevant: [] as readonly string[] })),
                  );

                  if (classifyResult.required.length > 0 && !config.requiredTools?.tools?.length) {
                    effectiveRequiredTools = [...classifyResult.required];
                    if (obs && isNormal) {
                      yield* obs.info(`◉ [classify]   required: ${classifyResult.required.join(", ")}`)
                        .pipe(Effect.catchAll(() => Effect.void));
                    }
                  }
                  if (classifyResult.relevant.length > 0) {
                    classifiedRelevantTools = classifyResult.relevant;
                    if (obs && isNormal) {
                      yield* obs.info(`◉ [classify]   relevant: ${classifyResult.relevant.join(", ")}`)
                        .pipe(Effect.catchAll(() => Effect.void));
                    }
                  }
                }

                // ── Auto per-tool call budget for research tools ──
                // When classification ran, automatically cap research-type tools so agents
                // don't loop indefinitely gathering context. Budget is applied by the gate.
                // Users can override via explicit requiredTools.maxCallsPerTool config.
                const RESEARCH_KEYWORDS = ["search", "http", "browse", "scrape", "fetch", "crawl"];
                const autoMaxCallsPerTool: Record<string, number> = {};
                for (const toolName of [
                  ...(effectiveRequiredTools ?? []),
                  ...(classifiedRelevantTools ?? []),
                ]) {
                  if (RESEARCH_KEYWORDS.some((k) => toolName.toLowerCase().includes(k))) {
                    autoMaxCallsPerTool[toolName] = 3;
                  }
                }

                // ── Semantic cache check (before reasoning) ──
                let cacheHit = false;
                if (config.enableCostTracking) {
                  const costOpt = yield* Effect.serviceOption(CostService).pipe(
                    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                  );
                  if (costOpt._tag === "Some") {
                    const taskText = extractTaskText(task.input);
                    const cached = yield* costOpt.value.checkCache(taskText)
                      .pipe(Effect.catchAll(() => Effect.succeed(null)));
                    if (cached !== null) {
                      cacheHit = true;
                      ctx = {
                        ...ctx,
                        metadata: {
                          ...ctx.metadata,
                          lastResponse: cached,
                          isComplete: true,
                          cacheHit: true,
                          stepsCount: 0,
                          reasoningSteps: [],
                          reasoningResult: { output: cached, status: "completed", metadata: { cost: 0, tokensUsed: 0, stepsCount: 0 } },
                        },
                      };
                      if (obs && isNormal) {
                        yield* obs.info("◉ [cache]      HIT — skipping reasoning")
                          .pipe(Effect.catchAll(() => Effect.void));
                      }
                    }
                  }
                }

                const reasoningOpt = yield* Effect.serviceOption(
                  Context.GenericTag<{
                    execute: (params: {
                      taskDescription: string;
                      taskType: string;
                      memoryContext: string;
                      availableTools: readonly string[];
                      availableToolSchemas?: readonly { name: string; description: string; parameters: readonly { name: string; type: string; description: string; required: boolean }[] }[];
                      allToolSchemas?: readonly { name: string; description: string; parameters: readonly { name: string; type: string; description: string; required: boolean }[] }[];
                      strategy?: string;
                      contextProfile?: Partial<ContextProfile>;
                      systemPrompt?: string;
                      taskId?: string;
                      resultCompression?: { budget?: number; previewItems?: number; autoStore?: boolean; codeTransform?: boolean };
                      agentId?: string;
                      sessionId?: string;
                      requiredTools?: readonly string[];
                      relevantTools?: readonly string[];
                      maxCallsPerTool?: Readonly<Record<string, number>>;
                      maxRequiredToolRetries?: number;
                      strategySwitching?: { enabled: boolean; maxSwitches?: number; fallbackStrategy?: string };
                      modelId?: string;
                      taskCategory?: string;
                      temperature?: number;
                      environmentContext?: Readonly<Record<string, string>>;
                      metaTools?: {
                        brief?: boolean;
                        find?: boolean;
                        pulse?: boolean;
                        recall?: boolean;
                        staticBriefInfo?: {
                          indexedDocuments: readonly { source: string; chunkCount: number; format: string }[];
                          availableSkills: readonly { name: string; purpose: string }[];
                          memoryBootstrap: { semanticLines: number; episodicEntries: number };
                        };
                        harnessContent?: string;
                      };
                      initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
                      synthesisConfig?: import("@reactive-agents/reasoning").SynthesisConfig;
                    }) => Effect.Effect<{
                      output: unknown;
                      status: string;
                      /** Individual reasoning steps (thought/action/observation) */
                      steps?: readonly {
                        id: string;
                        type: string;
                        content: string;
                        metadata?: { toolUsed?: string; duration?: number };
                      }[];
                      metadata: {
                        cost: number;
                        tokensUsed: number;
                        stepsCount: number;
                      };
                    }>;
                  }>("ReasoningService"),
                );

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

                  // ── Adaptive tool filtering ──
                  // When LLM classification produced relevant tools, use those.
                  // Otherwise fall back to heuristic filtering.
                  // All tools remain callable by name — filtering only affects what's
                  // shown in the prompt to reduce context noise.
                  if (config.adaptiveToolFiltering && availableToolSchemas.length > 10) {
                    // Always include conductor tools and spawn-agent regardless of relevance filtering
                    const ALWAYS_INCLUDE = new Set([
                      "recall", "find", "brief", "pulse",
                      "spawn-agent",
                    ]);

                    const requiredSet = new Set(effectiveRequiredTools ?? []);
                    let filteredSet: Set<string>;

                    if (classifiedRelevantTools && classifiedRelevantTools.length > 0) {
                      // LLM-classified: use required + relevant from classification
                      filteredSet = new Set([...classifiedRelevantTools, ...requiredSet]);
                    } else {
                      // Fallback: heuristic keyword matching
                      const taskTextForFilter = extractTaskText(task.input);
                      const { primary } = filterToolsByRelevance(taskTextForFilter, availableToolSchemas);
                      filteredSet = new Set(primary.map(t => t.name));
                    }
                    for (const name of ALWAYS_INCLUDE) filteredSet.add(name);
                    for (const name of requiredSet) filteredSet.add(name);

                    // Filter schemas to only those in the filtered set
                    const filtered = availableToolSchemas.filter(t => filteredSet.has(t.name));

                    // Only apply filtering if it actually reduces the set meaningfully
                    if (filtered.length < availableToolSchemas.length && filtered.length >= 2) {
                      const hiddenCount = availableToolSchemas.length - filtered.length;
                      availableToolSchemas = filtered;
                      availableToolNames = filtered.map(t => t.name);
                      if (obs && isNormal) {
                        yield* obs.info(`◉ [adaptive-tools] showing ${filtered.length} of ${filtered.length + hiddenCount} tools (${hiddenCount} hidden)`)
                          .pipe(Effect.catchAll(() => Effect.void));
                      }
                    }
                  }

                  // ── Subscribe to reasoning steps for live streaming ──
                  let unsubscribeReasoningSteps: (() => void) | null = null;
                  if (eb && obs && isVerbose) {
                    const capturedObs = obs;
                    const capturedLogModelIO = logModelIO;
                    const capturedIsDebug = isDebug;
                    unsubscribeReasoningSteps = yield* eb.on(
                      "ReasoningStepCompleted",
                      (event) => {
                        // Prompt trace: log full conversation thread when logModelIO is enabled.
                        if (event.prompt && capturedLogModelIO) {
                          const pass = event.kernelPass ?? event.strategy;
                          const indent = (s: string) => s.replace(/\n/g, "\n    ");

                          // Prefer full FC messages array (role-labelled) over flat text
                          if (event.messages && event.messages.length > 0) {
                            const threadLines = event.messages.map((m) =>
                              `[${m.role.toUpperCase()}] ${m.content}`,
                            ).join("\n    ────\n    ");
                            const sysLine = `── system ──\n    ${indent(event.prompt.system)}`;
                            const rawLine = event.rawResponse
                              ? `\n    ── raw response ──\n    ${indent(event.rawResponse)}`
                              : "";
                            return capturedObs
                              .debug(`  ┄ [model-io:${pass}]\n    ${sysLine}\n    ── thread (${event.messages.length} msg) ──\n    ${indent(threadLines)}${rawLine}`)
                              .pipe(Effect.catchAll(() => Effect.void));
                          }

                          // Fallback: legacy system+user flat format
                          const sysPreview = event.prompt.system;
                          const userPreview = event.prompt.user;
                          return capturedObs
                            .debug(`  ┄ [model-io:${pass}]\n    ── system ──\n    ${indent(sysPreview)}\n    ── user ──\n    ${indent(userPreview)}`)
                            .pipe(Effect.catchAll(() => Effect.void));
                        }
                        const rawContent = event.thought ?? event.action ?? event.observation ?? "";
                        // Skip events with no displayable content (e.g. prompt-only events when logModelIO is off)
                        if (!rawContent) return Effect.void;
                        const prefix = event.thought
                          ? "┄ [thought]"
                          : event.action
                            ? "┄ [action] "
                            : "┄ [obs]    ";
                        const content =
                          capturedIsDebug || rawContent.length <= 180
                            ? rawContent
                            : rawContent.slice(0, 180) + "...";
                        return capturedObs
                          .debug(`  ${prefix}  ${content}`)
                          .pipe(Effect.catchAll(() => Effect.void));
                      },
                    );
                  }

                  ctx = yield* guardedPhase(ctx, "think", (c) =>
                    Effect.gen(function* () {
                      // ── Self-improvement read-back: surface prior strategy outcomes ──
                      let memCtx = String((c.memoryContext as any)?.semanticContext ?? "");
                      if (config.enableSelfImprovement) {
                        const episodes = (c.memoryContext as any)?.recentEpisodes as
                          | readonly { eventType?: string; content?: string; metadata?: Record<string, unknown> }[]
                          | undefined;
                        if (episodes && episodes.length > 0) {
                          const selfImprovementEntries = episodes.filter(
                            (e) => e.eventType === "strategy-outcome" || e.eventType === "reflexion-critique",
                          );
                          if (selfImprovementEntries.length > 0) {
                            const formatted = selfImprovementEntries
                              .map((e) => {
                                const meta = e.metadata ?? {};
                                const success = meta.success ? "✓" : "✗";
                                const strategy = meta.strategy ?? "unknown";
                                return `[${success} ${strategy}] ${e.content ?? ""}`;
                              })
                              .join("\n");
                            memCtx = `${memCtx}\n\n--- Prior Strategy Outcomes ---\n${formatted}`;
                          }
                        }
                      }

                      // ── Task context injection ──
                      if (config.taskContext && Object.keys(config.taskContext).length > 0) {
                        const lines = Object.entries(config.taskContext)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join("\n");
                        memCtx = `--- Task Context ---\n${lines}\n\n${memCtx}`;
                      }

                      // ── Session resumption: surface prior debrief + active plan ──
                      {
                        const debriefOpt = yield* Effect.serviceOption(DebriefStoreService)
                          .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
                        if (debriefOpt._tag === "Some") {
                          const recentDebriefs = yield* debriefOpt.value.listByAgent(config.agentId, 1)
                            .pipe(Effect.catchAll(() => Effect.succeed([])));
                          if (recentDebriefs.length > 0) {
                            const last = recentDebriefs[0];
                            const ageHours = (Date.now() - last.createdAt) / 3_600_000;
                            if (ageHours < 72) {
                              const lines: string[] = [
                                `Last run (${Math.round(ageHours)}h ago): ${last.debrief.outcome}`,
                                last.debrief.summary,
                              ];
                              if (last.debrief.lessonsLearned?.length > 0) {
                                lines.push(`Lessons: ${last.debrief.lessonsLearned.join("; ")}`);
                              }
                              if (last.debrief.errorsEncountered?.length > 0) {
                                lines.push(`Prior errors: ${last.debrief.errorsEncountered.join("; ")}`);
                              }
                              memCtx = `${memCtx}\n\n--- Prior Session ---\n${lines.join("\n")}`;
                            }
                          }
                        }

                        const planOpt = yield* Effect.serviceOption(PlanStoreService)
                          .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
                        if (planOpt._tag === "Some") {
                          const recentPlans = yield* planOpt.value.getRecentPlans(config.agentId, 1)
                            .pipe(Effect.catchAll(() => Effect.succeed([])));
                          if (recentPlans.length > 0) {
                            const last = recentPlans[0];
                            if (last.status === "active") {
                              const pending = last.steps.filter(
                                (s) => s.status === "pending" || s.status === "in_progress",
                              );
                              if (pending.length > 0) {
                                const stepsText = pending
                                  .map((s) => `  - [${s.status}] ${s.title}`)
                                  .join("\n");
                                memCtx = `${memCtx}\n\n--- Incomplete Plan (resume if relevant) ---\nGoal: ${last.goal}\n${stepsText}`;
                              }
                            }
                          }
                        }
                      }

                      type ReasoningResult = {
                        output: unknown;
                        status: string;
                        strategy?: string;
                        steps?: readonly { id: string; type: string; content: string; metadata?: { toolUsed?: string; duration?: number } }[];
                        metadata: { cost: number; tokensUsed: number; stepsCount: number; strategyFallback?: boolean; confidence?: number };
                      };
                      let result: ReasoningResult;
                      // Build initial messages — seed the conversation thread with the task
                      const initialMessages: readonly { readonly role: "user" | "assistant"; readonly content: string }[] = [
                        { role: "user", content: extractTaskText(task.input) },
                      ];
                      // Local-tier strategy routing: plan-execute-reflect for multi-step tool tasks
                      const configuredStrategy = c.selectedStrategy ?? "reactive";
                      const tierOverride = recommendStrategyForTier(
                        config.contextProfile?.tier,
                        configuredStrategy,
                        effectiveRequiredTools,
                      );
                      const effectiveStrategy = tierOverride ?? configuredStrategy;

                      const strategyEffect = reasoningOpt.value.execute({
                        taskDescription: extractTaskText(task.input),
                        taskType: task.type,
                        memoryContext: memCtx,
                        availableTools: availableToolNames,
                        availableToolSchemas,
                        allToolSchemas,
                        strategy: effectiveStrategy,
                        contextProfile: config.contextProfile,
                        systemPrompt: config.systemPrompt,
                        taskId: c.taskId,
                        resultCompression: config.resultCompression,
                        agentId: config.agentId,
                        sessionId: c.taskId,
                        requiredTools: effectiveRequiredTools,
                        relevantTools: classifiedRelevantTools,
                        maxCallsPerTool: Object.keys(autoMaxCallsPerTool).length > 0 ? autoMaxCallsPerTool : undefined,
                        maxRequiredToolRetries: config.requiredTools?.maxRetries,
                        strategySwitching: config.strategySwitching,
                        modelId: String(config.defaultModel ?? ""),
                        taskCategory,
                        temperature: config.contextProfile?.temperature as number | undefined,
                        environmentContext: config.environmentContext as Record<string, string> | undefined,
                        metaTools: config.metaTools,
                        initialMessages,
                        synthesisConfig: resolveSynthesisConfigForStrategy(
                          config.reasoningOptions,
                          effectiveStrategy,
                          config.synthesisConfig,
                        ),
                      });
                      const strategyOutcome = yield* Effect.exit(strategyEffect);
                      if (strategyOutcome._tag === "Success") {
                        result = strategyOutcome.value as ReasoningResult;
                      } else {
                        const strategyError = strategyOutcome.cause;
                        if (obs) {
                          yield* obs.info(`⚠ Strategy failed, using fallback: ${String(strategyError)}`).pipe(Effect.catchAll(() => Effect.void));
                        }
                        result = {
                          output: `Strategy execution failed: ${String(strategyError)}`,
                          status: "error",
                          steps: [],
                          metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, strategyFallback: true },
                        };
                      }
                      // Prefer result.metadata.selectedStrategy (set by adaptive to show actual sub-strategy)
                      // over result.strategy (which stays "adaptive" for API compatibility).
                      const activeStrategy =
                        (result as any).metadata?.selectedStrategy ??
                        result.strategy ??
                        c.selectedStrategy;

                      return {
                        ...c,
                        selectedStrategy: activeStrategy,
                        cost: c.cost + (result.metadata.cost ?? 0),
                        tokensUsed:
                          c.tokensUsed + (result.metadata.tokensUsed ?? 0),
                        metadata: {
                          ...c.metadata,
                          lastResponse: String(result.output ?? ""),
                          isComplete: result.status === "completed",
                          reasoningResult: result,
                          stepsCount: result.metadata.stepsCount,
                          reasoningSteps: result.steps ?? [],
                        },
                      };
                    }),
                  );

                  // ── Unsubscribe from reasoning step events ──
                  if (unsubscribeReasoningSteps) {
                    unsubscribeReasoningSteps();
                    unsubscribeReasoningSteps = null;
                  }

                  // ── Harness hooks (post-think) ─────────────────────────────────────
                  //
                  // These run after the think phase when the reasoning service is
                  // available and the result is in ctx.metadata.lastResponse.

                  // withCustomTermination: re-run reasoning if predicate not satisfied
                  if (config.customTermination && !cacheHit && reasoningOpt._tag === "Some") {
                    const MAX_CUSTOM_RETRIES = 3;
                    let customRetries = 0;
                    while (customRetries < MAX_CUSTOM_RETRIES) {
                      const currentOutput = String(ctx.metadata.lastResponse ?? "");
                      if ((config.customTermination as (s: { output: string }) => boolean)({ output: currentOutput })) break;
                      customRetries++;
                      const retryOutcome = yield* Effect.exit(
                        reasoningOpt.value.execute({
                          taskDescription: extractTaskText(task.input),
                          taskType: task.type,
                          memoryContext: String((ctx.metadata as any)?.semanticContext ?? ""),
                          availableTools: availableToolNames,
                          availableToolSchemas,
                          allToolSchemas,
                          strategy: ctx.selectedStrategy ?? "reactive",
                          contextProfile: config.contextProfile,
                          systemPrompt: config.systemPrompt,
                          taskId: ctx.taskId,
                          resultCompression: config.resultCompression,
                          agentId: config.agentId,
                          sessionId: ctx.taskId,
                          requiredTools: effectiveRequiredTools,
                          modelId: String(config.defaultModel ?? ""),
                          taskCategory,
                          initialMessages: [
                            { role: "user" as const, content: extractTaskText(task.input) },
                            { role: "assistant" as const, content: currentOutput },
                            { role: "user" as const, content: "Continue working towards the goal." },
                          ],
                          synthesisConfig: resolveSynthesisConfigForStrategy(
                            config.reasoningOptions,
                            ctx.selectedStrategy ?? "reactive",
                            config.synthesisConfig,
                          ),
                        }),
                      );
                      if (retryOutcome._tag === "Success") {
                        const retryResult = retryOutcome.value as typeof result;
                        ctx = {
                          ...ctx,
                          cost: ctx.cost + (retryResult.metadata.cost ?? 0),
                          tokensUsed: ctx.tokensUsed + (retryResult.metadata.tokensUsed ?? 0),
                          metadata: {
                            ...ctx.metadata,
                            lastResponse: String(retryResult.output ?? ""),
                            reasoningResult: retryResult,
                          },
                        };
                      } else {
                        break;
                      }
                    }
                  }

                  // withMinIterations: re-run if fewer iterations than required
                  if (config.minIterations && !cacheHit && reasoningOpt._tag === "Some") {
                    const reasoningResultMeta = ctx.metadata.reasoningResult as any;
                    const iterationsDone = ctx.iteration - 1;
                    if (iterationsDone < config.minIterations) {
                      const continuationOutcome = yield* Effect.exit(
                        reasoningOpt.value.execute({
                          taskDescription: extractTaskText(task.input),
                          taskType: task.type,
                          memoryContext: String((ctx.metadata as any)?.semanticContext ?? ""),
                          availableTools: availableToolNames,
                          availableToolSchemas,
                          allToolSchemas,
                          strategy: ctx.selectedStrategy ?? "reactive",
                          contextProfile: config.contextProfile,
                          systemPrompt: config.systemPrompt,
                          taskId: ctx.taskId,
                          resultCompression: config.resultCompression,
                          agentId: config.agentId,
                          sessionId: ctx.taskId,
                          requiredTools: effectiveRequiredTools,
                          modelId: String(config.defaultModel ?? ""),
                          taskCategory,
                          initialMessages: [
                            { role: "user" as const, content: extractTaskText(task.input) },
                            { role: "assistant" as const, content: String(ctx.metadata.lastResponse ?? "") },
                            { role: "user" as const, content: "Continue — ensure thoroughness before finalizing." },
                          ],
                          synthesisConfig: resolveSynthesisConfigForStrategy(
                            config.reasoningOptions,
                            ctx.selectedStrategy ?? "reactive",
                            config.synthesisConfig,
                          ),
                        }),
                      );
                      if (continuationOutcome._tag === "Success") {
                        const contResult = continuationOutcome.value as typeof result;
                        ctx = {
                          ...ctx,
                          cost: ctx.cost + (contResult.metadata.cost ?? 0),
                          tokensUsed: ctx.tokensUsed + (contResult.metadata.tokensUsed ?? 0),
                          metadata: {
                            ...ctx.metadata,
                            lastResponse: String(contResult.output ?? ""),
                            reasoningResult: contResult,
                          },
                        };
                      }
                    }
                  }

                  // withVerificationStep (reflect mode): one extra LLM call to confirm completeness
                  if (config.verificationStep?.mode === "reflect" && !cacheHit && reasoningOpt._tag === "Some") {
                    const outputToVerify = String(ctx.metadata.lastResponse ?? "");
                    if (outputToVerify) {
                      const verifyPrompt = config.verificationStep.prompt ??
                        `Review this output against the task: "${extractTaskText(task.input).slice(0, 300)}"\n\nOutput:\n${outputToVerify.slice(0, 1500)}\n\nRespond PASS if the output fully addresses the task, or REVISE: [specific gap] if not.`;
                      const verifyOutcome = yield* Effect.exit(
                        reasoningOpt.value.execute({
                          taskDescription: verifyPrompt,
                          taskType: "analysis",
                          memoryContext: "",
                          availableTools: [],
                          strategy: "reactive",
                          contextProfile: config.contextProfile,
                          systemPrompt: undefined,
                          taskId: ctx.taskId,
                          agentId: config.agentId,
                          sessionId: ctx.taskId,
                          modelId: String(config.defaultModel ?? ""),
                          taskCategory,
                          initialMessages: [{ role: "user" as const, content: verifyPrompt }],
                          synthesisConfig: undefined,
                        }),
                      );
                      if (verifyOutcome._tag === "Success") {
                        const verifyContent = String(verifyOutcome.value.output ?? "");
                        const metaUpdate = verifyContent.startsWith("REVISE")
                          ? { verificationFeedback: verifyContent }
                          : {};
                        ctx = {
                          ...ctx,
                          cost: ctx.cost + (verifyOutcome.value.metadata.cost ?? 0),
                          tokensUsed: ctx.tokensUsed + (verifyOutcome.value.metadata.tokensUsed ?? 0),
                          metadata: { ...ctx.metadata, ...metaUpdate },
                        };
                      }
                    }
                  }

                  // withOutputValidator: validate output, retry with injected feedback on failure
                  if (config.outputValidator && !cacheHit && reasoningOpt._tag === "Some") {
                    const maxRetries = (config.outputValidatorOptions?.maxRetries ?? 2);
                    let validatorRetries = 0;
                    while (validatorRetries < maxRetries) {
                      const currentOutput = String(ctx.metadata.lastResponse ?? "");
                      const validation = (config.outputValidator as (o: string) => { valid: boolean; feedback?: string })(currentOutput);
                      if (validation.valid) break;
                      validatorRetries++;
                      const feedback = validation.feedback ?? "The previous response did not meet requirements. Please revise.";
                      const retryOutcome = yield* Effect.exit(
                        reasoningOpt.value.execute({
                          taskDescription: extractTaskText(task.input),
                          taskType: task.type,
                          memoryContext: String((ctx.metadata as any)?.semanticContext ?? ""),
                          availableTools: availableToolNames,
                          availableToolSchemas,
                          allToolSchemas,
                          strategy: ctx.selectedStrategy ?? "reactive",
                          contextProfile: config.contextProfile,
                          systemPrompt: config.systemPrompt,
                          taskId: ctx.taskId,
                          resultCompression: config.resultCompression,
                          agentId: config.agentId,
                          sessionId: ctx.taskId,
                          requiredTools: effectiveRequiredTools,
                          modelId: String(config.defaultModel ?? ""),
                          taskCategory,
                          initialMessages: [
                            { role: "user" as const, content: extractTaskText(task.input) },
                            { role: "assistant" as const, content: currentOutput },
                            { role: "user" as const, content: feedback },
                          ],
                          synthesisConfig: resolveSynthesisConfigForStrategy(
                            config.reasoningOptions,
                            ctx.selectedStrategy ?? "reactive",
                            config.synthesisConfig,
                          ),
                        }),
                      );
                      if (retryOutcome._tag === "Success") {
                        const retryResult = retryOutcome.value as typeof result;
                        ctx = {
                          ...ctx,
                          cost: ctx.cost + (retryResult.metadata.cost ?? 0),
                          tokensUsed: ctx.tokensUsed + (retryResult.metadata.tokensUsed ?? 0),
                          metadata: {
                            ...ctx.metadata,
                            lastResponse: String(retryResult.output ?? ""),
                            reasoningResult: retryResult,
                          },
                        };
                      } else {
                        break;
                      }
                    }
                  }

                  // ── Log think summary ──
                  if (obs && isNormal) {
                    const thinkResult = ctx.metadata.reasoningResult as any;
                    const stepsCount = ctx.metadata.stepsCount as number ?? 0;
                    const tokTot = ctx.tokensUsed;
                    const thinkMs = thinkResult?.metadata?.duration ?? 0;
                    // Show adaptive sub-strategy: thinkResult.strategy stays "adaptive",
                    // ctx.selectedStrategy is what actually ran (e.g. "reactive").
                    const entryStrat = (thinkResult as any)?.strategy as string | undefined;
                    const activeStrat = ctx.selectedStrategy ?? entryStrat ?? "";
                    const stratSuffix = (entryStrat === "adaptive" && activeStrat !== "adaptive")
                      ? ` (adaptive→${activeStrat})`
                      : "";
                    yield* obs.info(`◉ [think]      ${stepsCount} steps | ${tokTot.toLocaleString()} tok | ${(thinkMs / 1000).toFixed(1)}s${stratSuffix}`)
                      .pipe(Effect.catchAll(() => Effect.void));
                  }

                  // ── Bridge reasoning path → episodic memory ──
                  // The direct-LLM path logs via logEpisode() inline, but the reasoning
                  // path (ReasoningService.execute) handles tools internally and never
                  // reaches those code paths. Log the task+result here so bootstrap()
                  // can surface prior runs on the next invocation.
                  {
                    const thinkRes = ctx.metadata.reasoningResult as any;
                    if (thinkRes?.output) {
                      const memBridge = yield* Effect.serviceOption(
                        Context.GenericTag<{
                          logEpisode: (episode: unknown) => Effect.Effect<void>;
                        }>("MemoryService"),
                      ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
                      if (memBridge._tag === "Some") {
                        const epNow = new Date();
                        const durationMs = Date.now() - ctx.startedAt.getTime();
                        const success = thinkRes.status === "completed";
                        const strategyUsed = thinkRes.strategy ?? ctx.selectedStrategy ?? "unknown";

                        yield* memBridge.value.logEpisode({
                          id: crypto.randomUUID().replace(/-/g, ""),
                          agentId: ctx.agentId,
                          date: epNow.toISOString().slice(0, 10),
                          content: `Task: ${String(task.input).slice(0, 200)} → ${String(thinkRes.output).slice(0, 300)}`,
                          taskId: ctx.taskId,
                          eventType: config.enableSelfImprovement ? "strategy-outcome" : "task-completed",
                          createdAt: epNow,
                          metadata: {
                            steps: ctx.metadata.stepsCount ?? 0,
                            tokensUsed: ctx.tokensUsed,
                            strategy: strategyUsed,
                            success,
                            durationMs,
                            ...(config.enableSelfImprovement ? {
                              selfImprovement: true,
                              taskDescription: String(task.input).slice(0, 500),
                              taskType: task.type,
                            } : {}),
                          },
                        }).pipe(Effect.catchAll(() => Effect.void));

                        // ── Persist reflexion critiques for cross-run learning ──
                        const reflexionCritiques = thinkRes.metadata?.reflexionCritiques;
                        if (Array.isArray(reflexionCritiques) && reflexionCritiques.length > 0) {
                          yield* memBridge.value.logEpisode({
                            id: crypto.randomUUID().replace(/-/g, ""),
                            agentId: ctx.agentId,
                            date: epNow.toISOString().slice(0, 10),
                            content: `Reflexion critiques for ${task.type}: ${reflexionCritiques.join(" | ")}`,
                            taskId: ctx.taskId,
                            eventType: "reflexion-critique",
                            createdAt: epNow,
                            tags: ["reflexion", "critique", task.type],
                            metadata: {
                              strategy: strategyUsed,
                              critiqueCount: reflexionCritiques.length,
                              taskDescription: String(task.input).slice(0, 500),
                            },
                          }).pipe(Effect.catchAll(() => Effect.void));
                        }
                      }
                    }
                  }

                  // ── Record experience for cross-agent learning ──
                  if (config.enableExperienceLearning) {
                    const expRecOpt = yield* Effect.serviceOption(
                      Context.GenericTag<{
                        record: (entry: unknown) => Effect.Effect<void>;
                      }>("ExperienceStore"),
                    ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

                    if (expRecOpt._tag === "Some") {
                      const reasoningStepsForExp = (ctx.metadata.reasoningSteps ?? []) as Array<{
                        type: string;
                        metadata?: { toolUsed?: string };
                      }>;
                      const toolsFromSteps = reasoningStepsForExp
                        .filter(s => s.type === "action")
                        .map(s => s.metadata?.toolUsed ?? "unknown")
                        .filter((t, i, arr) => arr.indexOf(t) === i && t !== "unknown"); // unique, drop unknowns

                      yield* expRecOpt.value.record({
                        agentId: ctx.agentId,
                        taskDescription: extractTaskText(task.input),
                        taskType: task.type ?? "general",
                        toolsUsed: toolsFromSteps,
                        success: (ctx.metadata.reasoningResult as any)?.status === "completed",
                        totalSteps: (ctx.metadata.stepsCount as number) ?? 0,
                        totalTokens: ctx.tokensUsed,
                        errors: [],
                        modelTier: config.contextProfile?.tier ?? "mid",
                      }).pipe(Effect.catchAll(() => Effect.void));
                    }
                  }

                  // ── Fire "act" + "observe" phases if reasoning used tools ──
                  // Extract action steps from the reasoning result so hooks
                  // (e.g. .withHook({ phase: "act" })) have visibility into tool calls.
                  const reasoningSteps = (ctx.metadata.reasoningSteps ?? []) as Array<{
                    id: string;
                    type: string;
                    content: string;
                    metadata?: { toolUsed?: string; duration?: number; observationResult?: { success?: boolean } };
                  }>;
                  const actionSteps = reasoningSteps.filter((s) => s.type === "action");

                  if (actionSteps.length > 0) {
                    // Log act phase summary at normal verbosity
                    if (obs && isNormal) {
                      const toolsUsed = actionSteps
                        .map((s) => s.metadata?.toolUsed ?? s.content.split("(")[0]?.trim() ?? "?")
                        .join(", ");
                      yield* obs.info(`◉ [act]        ${toolsUsed} (${actionSteps.length} tools)`)
                        .pipe(Effect.catchAll(() => Effect.void));
                    }

                    const syntheticToolResults = actionSteps.map((s) => {
                      const actionIdx = reasoningSteps.indexOf(s);
                      const nextStep = actionIdx >= 0 ? reasoningSteps[actionIdx + 1] : undefined;
                      const success = nextStep?.type === "observation"
                        ? (nextStep.metadata?.observationResult?.success ?? true)
                        : true;
                      return {
                        toolName: s.metadata?.toolUsed ?? s.content.split("(")[0]?.trim() ?? "unknown",
                        toolCallId: s.id,
                        result: s.content,
                        durationMs: s.metadata?.duration ?? 0,
                        success,
                      };
                    });

                    ctx = { ...ctx, toolResults: syntheticToolResults };

                    // Tool metrics are now recorded via KernelHooks.onObservation → ToolCallCompleted
                    // EventBus events. MetricsCollector auto-subscribes to these events.
                    // (Previously duplicated here via obs.recordHistogram — removed to fix double counting.)

                    ctx = yield* guardedPhase(ctx, "act", (c) =>
                      Effect.succeed(c),
                    );
                    ctx = yield* guardedPhase(ctx, "observe", (c) =>
                      Effect.succeed(c),
                    );
                  }

                  // Update iteration to reflect actual reasoning steps
                  ctx = {
                    ...ctx,
                    iteration: (ctx.metadata.stepsCount as number | undefined) ?? 1,
                  };

                  // ── Semantic cache store (after successful reasoning) ──
                  if (config.enableCostTracking && ctx.metadata.lastResponse) {
                    const costOpt2 = yield* Effect.serviceOption(CostService).pipe(
                      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                    );
                    if (costOpt2._tag === "Some") {
                      yield* costOpt2.value
                        .cacheResponse(
                          extractTaskText(task.input),
                          String(ctx.metadata.lastResponse),
                          String(ctx.selectedModel ?? "unknown"),
                        )
                        .pipe(Effect.catchAll(() => Effect.void));
                    }
                  }
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
                                  Effect.catchAll(() => Effect.void),
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
                      }).pipe(Effect.catchAll(() => Effect.void));
                    }
                    // Phase 0.5: Track iteration gauge
                    if (obs) {
                      yield* obs.setGauge("execution.iteration", ctx.iteration, { taskId: ctx.taskId })
                        .pipe(Effect.catchAll(() => Effect.void));
                    }

                    // 5a. THINK
                    ctx = yield* guardedPhase(
                      ctx,
                      "think",
                      (c) =>
                        Effect.gen(function* () {
                          const llm = yield* Context.GenericTag<{
                            complete: (req: unknown) => Effect.Effect<{
                              content: string;
                              toolCalls?: unknown[];
                              stopReason: string;
                              usage?: {
                                totalTokens?: number;
                                estimatedCost?: number;
                              };
                            }>;
                          }>("LLMService");

                          const defaultPrompt =
                            config.systemPrompt ??
                            "You are a helpful AI assistant.";

                          // Phase 1.1: Use buildContext() properly when available
                          let messagesToSend: readonly unknown[];
                          if (contextManagerOpt._tag === "Some") {
                            messagesToSend = yield* contextManagerOpt.value
                              .buildContext({
                                systemPrompt: defaultPrompt,
                                messages: c.messages,
                                memoryContext: String(
                                  (c.memoryContext as any)?.semanticContext ?? "",
                                ) || undefined,
                                maxTokens: 100_000,
                                reserveOutputTokens: 4096,
                              })
                              .pipe(
                                Effect.catchAll(() =>
                                  Effect.succeed(c.messages as unknown[]),
                                ),
                              );
                          } else {
                            // Fallback: simple system prompt prepend
                            const systemPrompt = c.memoryContext
                              ? `${String((c.memoryContext as any).semanticContext ?? "")}\n\n${defaultPrompt}`
                              : defaultPrompt;
                            messagesToSend = [
                              { role: "system", content: systemPrompt },
                              ...c.messages,
                            ];
                          }

                          // Convert function-calling tools to LLM ToolDefinition format
                          const llmTools =
                            functionCallingTools.length > 0
                              ? functionCallingTools.map((t: any) => ({
                                  name: t.name,
                                  description: t.description,
                                  inputSchema: t.input_schema,
                                }))
                              : undefined;

                          const llmRequest = {
                            messages: messagesToSend,
                            model: c.selectedModel,
                            ...(llmTools ? { tools: llmTools } : {}),
                          };

                          const reqId = `req-${Date.now()}`;
                          if (eb) {
                            yield* eb.publish({
                              _tag: "LLMRequestStarted",
                              taskId: c.taskId,
                              requestId: reqId,
                              model: String(c.selectedModel ?? "unknown"),
                              provider: String(c.provider ?? "unknown"),
                              contextSize: messagesToSend.length,
                            }).pipe(Effect.catchAll(() => Effect.void));
                          }

                          const llmCallStart = performance.now();
                          const response = yield* llm.complete(llmRequest);
                          const llmDurationMs = performance.now() - llmCallStart;

                          // Update selectedModel to the actual model used by the provider
                          const actualModel = (response as any).model;
                          if (actualModel) {
                            c = { ...c, selectedModel: actualModel };
                          }

                          // Phase 0.2: Publish LLMRequestCompleted event
                          if (eb) {
                            yield* eb.publish({
                              _tag: "LLMRequestCompleted",
                              taskId: c.taskId,
                              requestId: reqId,
                              model: String(c.selectedModel ?? "unknown"),
                              provider: String(c.provider ?? "unknown"),
                              durationMs: llmDurationMs,
                              tokensUsed: response.usage?.totalTokens ?? 0,
                              estimatedCost: response.usage?.estimatedCost ?? 0,
                            }).pipe(Effect.catchAll(() => Effect.void));
                          }

                          // Phase 0.5: Record LLM timing histogram
                          if (obs) {
                            yield* obs.recordHistogram(
                              "llm.request.duration_ms",
                              llmDurationMs,
                              { model: String(c.selectedModel ?? "unknown") },
                            ).pipe(Effect.catchAll(() => Effect.void));
                          }

                          // Verbose: log LLM call details
                          if (obs && isVerbose) {
                            const modelName = String((c.selectedModel as any)?.model ?? c.selectedModel ?? "unknown");
                            const toks = response.usage?.totalTokens ?? 0;
                            const stopReason = response.stopReason ?? "?";
                            yield* obs.debug(
                              `  ┄ [llm]    ${modelName} | ${toks.toLocaleString()} tok | ${stopReason} | ${(llmDurationMs / 1000).toFixed(1)}s`,
                            ).pipe(Effect.catchAll(() => Effect.void));
                            const ctxSize = messagesToSend.length;
                            yield* obs.debug(
                              `  ┄ [ctx]    ${ctxSize} msgs | ~${toks.toLocaleString()} tok used`,
                            ).pipe(Effect.catchAll(() => Effect.void));
                          }

                          // Phase 1.3: Log LLM interaction as episodic memory
                          const memOpt = yield* Effect.serviceOption(
                            Context.GenericTag<{
                              logEpisode: (episode: unknown) => Effect.Effect<void>;
                            }>("MemoryService"),
                          ).pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({ _tag: "None" as const }),
                            ),
                          );
                          if (memOpt._tag === "Some") {
                            const now = new Date();
                            yield* memOpt.value
                              .logEpisode({
                                id: crypto.randomUUID().replace(/-/g, ""),
                                agentId: c.agentId,
                                date: now.toISOString().slice(0, 10),
                                content: `LLM response (${response.usage?.totalTokens ?? 0} tokens): ${response.content.slice(0, 200)}`,
                                taskId: c.taskId,
                                eventType: "decision-made",
                                createdAt: now,
                                metadata: {
                                  model: String(c.selectedModel ?? "unknown"),
                                  messageCount: messagesToSend.length,
                                  tokensUsed: response.usage?.totalTokens ?? 0,
                                  durationMs: llmDurationMs,
                                },
                              } as any)
                              .pipe(Effect.catchAll(() => Effect.void));
                          }

                          // When the response includes tool calls, store them as
                          // tool_use content blocks so multi-turn providers (Ollama)
                          // can properly associate the incoming tool results.
                          const assistantContent =
                            response.toolCalls && response.toolCalls.length > 0
                              ? [
                                  ...(response.content
                                    ? [{ type: "text" as const, text: response.content }]
                                    : []),
                                  ...(response.toolCalls as Array<{ id: string; name: string; input: unknown }>).map(
                                    (tc) => ({
                                      type: "tool_use" as const,
                                      id: tc.id,
                                      name: tc.name,
                                      input: tc.input ?? {},
                                    }),
                                  ),
                                ]
                              : response.content;
                          const updatedMessages = [
                            ...c.messages,
                            { role: "assistant", content: assistantContent },
                          ];

                          const done =
                            response.stopReason === "end_turn" &&
                            !response.toolCalls?.length;

                          // Phase 1.4: Get current trace ID for hook context
                          const traceId = obs
                            ? yield* obs.getTraceContext().pipe(
                                Effect.map((tc) => tc.traceId),
                                Effect.catchAll(() => Effect.succeed(undefined as string | undefined)),
                              )
                            : undefined;

                          return {
                            ...c,
                            messages: updatedMessages,
                            tokensUsed:
                              c.tokensUsed + (response.usage?.totalTokens ?? 0),
                            cost: c.cost + (response.usage?.estimatedCost ?? 0),
                            // Phase 1.4: Enrich context for hooks
                            lastLLMRequest: llmRequest,
                            lastLLMResponse: response,
                            availableTools: availableToolNames,
                            traceId,
                            metadata: {
                              ...c.metadata,
                              lastResponse: response.content,
                              pendingToolCalls: response.toolCalls ?? [],
                              isComplete: done,
                            },
                          };
                        }) as unknown as Effect.Effect<ExecutionContext, never>,
                    );

                    // Log thought phase for per-iteration progress visibility
                    yield* progressLogger.logIteration({
                      iteration: ctx.iteration,
                      maxIterations: ctx.maxIterations,
                      phase: "thought",
                      content: ctx.metadata.lastResponse as string,
                    }).pipe(Effect.catchAll(() => Effect.void));

                    // 5b. ACT (if tool calls present) — call real ToolService
                    const pendingCalls =
                      (ctx.metadata.pendingToolCalls as unknown[]) ?? [];
                    if (pendingCalls.length > 0) {
                      ctx = yield* guardedPhase(ctx, "act", (c) =>
                        Effect.gen(function* () {
                          const toolServiceOpt =
                            yield* Effect.serviceOption(ToolService);

                          const toolResults: unknown[] = yield* Effect.all(
                            pendingCalls.map((call: any) =>
                              Effect.gen(function* () {
                                const callId = call.id ?? "unknown";
                                const toolName =
                                  call.name ?? call.function?.name ?? "unknown";

                                // ── Behavioral contract: check tool call ──
                                if (config.enableBehavioralContracts) {
                                  const bcOpt = yield* Effect.serviceOption(BehavioralContractService)
                                    .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
                                  if (bcOpt._tag === "Some") {
                                    const violation = yield* bcOpt.value
                                      .checkToolCall(toolName, c.toolResults.length)
                                      .pipe(Effect.catchAll(() => Effect.succeed(null)));
                                    if (violation?.severity === "block") {
                                      return yield* Effect.fail(new BehavioralContractViolationError({
                                        message: violation.message, taskId: c.taskId,
                                        rule: violation.rule, violation: violation.message,
                                      }));
                                    }
                                  }
                                }
                                const rawArgs =
                                  call.input ??
                                  call.arguments ??
                                  call.function?.arguments ??
                                  {};
                                const args: Record<string, unknown> =
                                  typeof rawArgs === "string"
                                    ? (() => {
                                        try {
                                          return JSON.parse(rawArgs);
                                        } catch {
                                          return { input: rawArgs };
                                        }
                                      })()
                                    : (rawArgs as Record<string, unknown>);
                                // Log tool invocation before execution (direct-LLM path)
                                if (obs && isNormal) {
                                  const isAgentDelegateTool =
                                    toolName === "spawn-agent" ||
                                    toolName.startsWith("agent-");
                                  if (isAgentDelegateTool) {
                                    const taskArg = typeof args.task === "string"
                                      ? args.task.slice(0, 80)
                                      : typeof args.input === "string"
                                        ? args.input.slice(0, 80)
                                        : "";
                                    const nameSuffix = typeof args.name === "string" ? ` [${args.name}]` : "";
                                    yield* obs.info(
                                      `  ◉ [act]        ↓ ${toolName}${nameSuffix}: "${taskArg}"`,
                                    ).pipe(Effect.catchAll(() => Effect.void));
                                  } else {
                                    const argPreview = Object.entries(args)
                                      .slice(0, 2)
                                      .map(([k, v]) => `${k}: ${String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 40)}`)
                                      .join(", ");
                                    yield* obs.info(
                                      `  ◉ [act]        → ${toolName}(${argPreview})`,
                                    ).pipe(Effect.catchAll(() => Effect.void));
                                  }
                                }

                                const startMs = Date.now();

                                // Phase 0.2: Publish ToolCallStarted
                                if (eb) {
                                  yield* eb.publish({
                                    _tag: "ToolCallStarted",
                                    taskId: c.taskId,
                                    toolName,
                                    callId,
                                  }).pipe(Effect.catchAll(() => Effect.void));
                                }

                                if (toolServiceOpt._tag === "None") {
                                  const durationMs = Date.now() - startMs;
                                  if (eb) {
                                    yield* eb.publish({
                                      _tag: "ToolCallCompleted",
                                      taskId: c.taskId,
                                      toolName,
                                      callId,
                                      durationMs,
                                      success: false,
                                    }).pipe(Effect.catchAll(() => Effect.void));
                                  }
                                  return {
                                    toolCallId: callId,
                                    toolName,
                                    result: `[ToolService not available — add .withTools() to agent builder]`,
                                    durationMs,
                                  };
                                }

                                const toolResult = yield* toolServiceOpt.value
                                  .execute({
                                    toolName,
                                    arguments: args,
                                    agentId: c.agentId,
                                    sessionId: c.sessionId,
                                  })
                                  .pipe(
                                    Effect.map((r) => ({
                                      toolCallId: callId,
                                      toolName,
                                      result: r.result,
                                      durationMs: Date.now() - startMs,
                                      success: true,
                                    })),
                                    Effect.catchAll((e) =>
                                      Effect.succeed({
                                        toolCallId: callId,
                                        toolName,
                                        result: `[Tool error: ${e instanceof Error ? e.message : String(e)}]`,
                                        durationMs: Date.now() - startMs,
                                        success: false,
                                      }),
                                    ),
                                  );

                                // Log tool execution for progress visibility
                                yield* progressLogger.logToolExecution(
                                  toolName,
                                  toolResult.success ? "success" : "error",
                                  toolResult.durationMs,
                                  toolResult.success ? undefined : (toolResult.result as string),
                                ).pipe(Effect.catchAll(() => Effect.void));

                                // Phase 0.2: Publish ToolCallCompleted
                                if (eb) {
                                  yield* eb.publish({
                                    _tag: "ToolCallCompleted",
                                    taskId: c.taskId,
                                    toolName,
                                    callId,
                                    durationMs: toolResult.durationMs,
                                    success: toolResult.success,
                                  }).pipe(Effect.catchAll(() => Effect.void));
                                }

                                return toolResult;
                              }),
                            ),
                            { concurrency: 3 },
                          );

                          return {
                            ...c,
                            toolResults: [...c.toolResults, ...toolResults],
                          };
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
                        }).pipe(Effect.catchAll(() => Effect.void));
                      }

                      // 5c. OBSERVE — H5: also log episodic memories
                      ctx = yield* guardedPhase(ctx, "observe", (c) =>
                        Effect.gen(function* () {
                          const recentResults = c.toolResults.slice(
                            -pendingCalls.length,
                          );

                          // H5: Log tool results as episodic memory items
                          const memOpt = yield* Effect.serviceOption(
                            Context.GenericTag<{
                              logEpisode: (episode: unknown) => Effect.Effect<void>;
                            }>("MemoryService"),
                          ).pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({ _tag: "None" as const }),
                            ),
                          );

                          if (memOpt._tag === "Some") {
                            for (const r of recentResults) {
                              const episodeNow = new Date();
                              yield* memOpt.value
                                .logEpisode({
                                  id: crypto.randomUUID().replace(/-/g, ""),
                                  agentId: c.agentId,
                                  date: episodeNow.toISOString().slice(0, 10),
                                  content: `Tool ${(r as any).toolName}: ${String((r as any).result).slice(0, 300)}`,
                                  taskId: c.taskId,
                                  eventType: "tool-call",
                                  createdAt: episodeNow,
                                  metadata: {
                                    toolName: (r as any).toolName,
                                    durationMs: (r as any).durationMs ?? 0,
                                  },
                                } as any)
                                .pipe(Effect.catchAll(() => Effect.void));
                            }
                          }

                          // Verbose: log tool results
                          if (obs && isVerbose) {
                            for (const r of recentResults) {
                              const rToolName = (r as any).toolName as string;
                              const rResult = (r as any).result;
                              const isAgentDelegate =
                                rToolName === "spawn-agent" ||
                                rToolName.startsWith("agent-");
                              if (isAgentDelegate && typeof rResult === "object" && rResult !== null) {
                                const sub = rResult as { subAgentName?: string; success?: boolean; summary?: string; tokensUsed?: number };
                                const subIcon = sub.success ? "✓" : "✗";
                                const subName = sub.subAgentName ?? rToolName;
                                const subSummary = String(sub.summary ?? "").slice(0, 150);
                                const subTok = sub.tokensUsed ?? 0;
                                yield* obs.info(
                                  `  ◉ [sub-agent: ${subName}] ${subIcon} ${subTok} tok | "${subSummary}"`,
                                ).pipe(Effect.catchAll(() => Effect.void));
                              } else {
                                const resultStr = typeof rResult === "string"
                                  ? rResult
                                  : JSON.stringify(rResult);
                                const preview = resultStr.length > 120 ? resultStr.slice(0, 120) + "..." : resultStr;
                                const charCount = resultStr.length;
                                yield* obs.debug(
                                  `  ┄ [obs]    ${rToolName}: ${preview} [${charCount} chars]`,
                                ).pipe(Effect.catchAll(() => Effect.void));
                              }
                            }
                          }

                          const toolResultMessages = recentResults.map(
                            (r: any) => ({
                              role: "tool" as const,
                              toolCallId: r.toolCallId,
                              content:
                                typeof r.result === "string"
                                  ? r.result
                                  : JSON.stringify(r.result),
                            }),
                          );

                          // Aggregate sub-agent tokens/cost if present in tool results
                          let subAgentTokens = 0;
                          let subAgentCost = 0;
                          for (const r of recentResults) {
                            const res = (r as any).result;
                            if (typeof res === "object" && res !== null) {
                              subAgentTokens += (res as any).tokensUsed ?? 0;
                              subAgentCost += (res as any).cost ?? (res as any).estimatedCost ?? 0;
                            }
                          }

                          return {
                            ...c,
                            messages: [...c.messages, ...toolResultMessages],
                            tokensUsed: c.tokensUsed + subAgentTokens,
                            cost: c.cost + subAgentCost,
                            iteration: c.iteration + 1,
                          };
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
                        }).pipe(Effect.catchAll(() => Effect.void));
                      }

                      // Log iteration summary
                      yield* progressLogger.logIterationSummary(
                        ctx.iteration,
                        ctx.tokensUsed,
                        recentResults.map((r: any) => r.toolName),
                      ).pipe(Effect.catchAll(() => Effect.void));
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
                      ).pipe(Effect.catchAll(() => Effect.void));
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
                  // Mirror of the reasoning-path harness hooks for when no ReasoningService
                  // is available. Uses the LLMService directly for retries.
                  {
                    const llmHookOpt = yield* Effect.serviceOption(
                      Context.GenericTag<{
                        complete: (req: unknown) => Effect.Effect<{
                          content: string;
                          stopReason: string;
                          usage?: { totalTokens?: number; estimatedCost?: number };
                        }>;
                      }>("LLMService"),
                    ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

                    const callLLMForRetry = (messages: readonly { role: string; content: string }[]): Effect.Effect<string | null> =>
                      llmHookOpt._tag === "Some"
                        ? llmHookOpt.value.complete({
                            model: config.defaultModel ?? "test-model",
                            messages,
                            systemPrompt: config.systemPrompt ?? "You are a helpful AI assistant.",
                          }).pipe(
                            Effect.map((r: { content: string; usage?: { totalTokens?: number; estimatedCost?: number } }) => {
                              ctx = {
                                ...ctx,
                                tokensUsed: ctx.tokensUsed + (r.usage?.totalTokens ?? 0),
                                cost: ctx.cost + (r.usage?.estimatedCost ?? 0),
                              };
                              return r.content;
                            }),
                            Effect.catchAll(() => Effect.succeed(null as string | null)),
                          )
                        : Effect.succeed(null as string | null);

                    // withCustomTermination (direct-LLM)
                    if (config.customTermination && !cacheHit && llmHookOpt._tag === "Some") {
                      const MAX_CUSTOM_RETRIES = 3;
                      let customRetries = 0;
                      while (customRetries < MAX_CUSTOM_RETRIES) {
                        const currentOutput = String(ctx.metadata.lastResponse ?? "");
                        if ((config.customTermination as (s: { output: string }) => boolean)({ output: currentOutput })) break;
                        customRetries++;
                        const newContent = yield* callLLMForRetry([
                          { role: "user", content: extractTaskText(task.input) },
                          { role: "assistant", content: currentOutput },
                          { role: "user", content: "Continue working towards the goal." },
                        ]);
                        if (newContent !== null) {
                          ctx = { ...ctx, metadata: { ...ctx.metadata, lastResponse: newContent } };
                        } else {
                          break;
                        }
                      }
                    }

                    // withMinIterations (direct-LLM)
                    if (config.minIterations && !cacheHit && llmHookOpt._tag === "Some") {
                      const itersDone = (ctx.iteration - 1);
                      if (itersDone < config.minIterations) {
                        const newContent = yield* callLLMForRetry([
                          { role: "user", content: extractTaskText(task.input) },
                          { role: "assistant", content: String(ctx.metadata.lastResponse ?? "") },
                          { role: "user", content: "Continue — ensure thoroughness before finalizing." },
                        ]);
                        if (newContent !== null) {
                          ctx = { ...ctx, metadata: { ...ctx.metadata, lastResponse: newContent } };
                        }
                      }
                    }

                    // withVerificationStep reflect mode (direct-LLM)
                    if (config.verificationStep?.mode === "reflect" && !cacheHit && llmHookOpt._tag === "Some") {
                      const outputToVerify = String(ctx.metadata.lastResponse ?? "");
                      if (outputToVerify) {
                        const verifyPrompt = config.verificationStep.prompt ??
                          `Review this output against the task: "${extractTaskText(task.input).slice(0, 300)}"\n\nOutput:\n${outputToVerify.slice(0, 1500)}\n\nRespond PASS if the output fully addresses the task, or REVISE: [specific gap] if not.`;
                        const verifyContent = yield* callLLMForRetry([
                          { role: "user", content: verifyPrompt },
                        ]);
                        if (verifyContent !== null) {
                          const metaUpdate = verifyContent.startsWith("REVISE")
                            ? { verificationFeedback: verifyContent }
                            : {};
                          ctx = { ...ctx, metadata: { ...ctx.metadata, ...metaUpdate } };
                        }
                      }
                    }

                    // withOutputValidator (direct-LLM)
                    if (config.outputValidator && !cacheHit && llmHookOpt._tag === "Some") {
                      const maxRetries = config.outputValidatorOptions?.maxRetries ?? 2;
                      let validatorRetries = 0;
                      while (validatorRetries < maxRetries) {
                        const currentOutput = String(ctx.metadata.lastResponse ?? "");
                        const validation = (config.outputValidator as (o: string) => { valid: boolean; feedback?: string })(currentOutput);
                        if (validation.valid) break;
                        validatorRetries++;
                        const feedback = validation.feedback ?? "The previous response did not meet requirements. Please revise.";
                        const newContent = yield* callLLMForRetry([
                          { role: "user", content: extractTaskText(task.input) },
                          { role: "assistant", content: currentOutput },
                          { role: "user", content: feedback },
                        ]);
                        if (newContent !== null) {
                          ctx = { ...ctx, metadata: { ...ctx.metadata, lastResponse: newContent } };
                        } else {
                          break;
                        }
                      }
                    }
                  }

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
                    }).pipe(Effect.asVoid, Effect.catchAll(() => Effect.void));
                  }
                }

                // ── Phase 6: VERIFY (optional) ── H2
                if (config.enableVerification) {
                  ctx = yield* guardedPhase(ctx, "verify", (c) =>
                    Effect.gen(function* () {
                      const verifyOpt = yield* Effect.serviceOption(
                        VerificationService,
                      ).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({ _tag: "None" as const }),
                        ),
                      );

                      if (verifyOpt._tag === "Some") {
                        const response = String(c.metadata.lastResponse ?? "");
                        const input = extractTaskText(task.input);
                        const result = yield* verifyOpt.value
                          .verify(response, input)
                          .pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({
                                overallScore: 0.5,
                                passed: true,
                                riskLevel: "medium" as const,
                                layerResults: [],
                                recommendation: "accept" as const,
                                verifiedAt: new Date(),
                              }),
                            ),
                          );

                        return {
                          ...c,
                          agentState: "verifying" as const,
                          metadata: {
                            ...c.metadata,
                            verificationResult: result,
                            verificationScore: result.overallScore,
                          },
                        };
                      }

                      return c;
                    }),
                  );
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
                      ).pipe(Effect.catchAll(() => Effect.void));
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

                    // Re-run the think phase (single retry call)
                    ctx = yield* guardedPhase(ctx, "think", (c) =>
                      Effect.gen(function* () {
                        const llm = yield* Context.GenericTag<{
                          complete: (req: unknown) => Effect.Effect<{
                            content: string;
                            toolCalls?: unknown[];
                            stopReason: string;
                            usage?: {
                              totalTokens?: number;
                              estimatedCost?: number;
                            };
                          }>;
                        }>("LLMService");

                        const defaultPrompt =
                          config.systemPrompt ?? "You are a helpful AI assistant.";
                        const messagesToSend = [
                          { role: "system", content: defaultPrompt },
                          ...c.messages,
                        ];

                        const llmRequest = {
                          messages: messagesToSend,
                          model: c.selectedModel,
                        };

                        const response = yield* llm.complete(llmRequest);

                        const retryDone =
                          response.stopReason === "end_turn" &&
                          !response.toolCalls?.length;

                        return {
                          ...c,
                          messages: [
                            ...c.messages,
                            { role: "assistant", content: response.content },
                          ],
                          tokensUsed:
                            c.tokensUsed + (response.usage?.totalTokens ?? 0),
                          cost: c.cost + (response.usage?.estimatedCost ?? 0),
                          iteration: c.iteration + 1,
                          metadata: {
                            ...c.metadata,
                            lastResponse: response.content,
                            isComplete: retryDone,
                          },
                        };
                      }) as unknown as Effect.Effect<ExecutionContext, never>,
                    );

                    // Re-run verification on the revised response
                    if (config.enableVerification) {
                      ctx = yield* guardedPhase(ctx, "verify", (c) =>
                        Effect.gen(function* () {
                          const verifyOpt = yield* Effect.serviceOption(
                            VerificationService,
                          ).pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({ _tag: "None" as const }),
                            ),
                          );

                          if (verifyOpt._tag === "Some") {
                            const response = String(c.metadata.lastResponse ?? "");
                            const input = extractTaskText(task.input);
                            const result = yield* verifyOpt.value
                              .verify(response, input)
                              .pipe(
                                Effect.catchAll(() =>
                                  Effect.succeed({
                                    overallScore: 0.5,
                                    passed: true,
                                    riskLevel: "medium" as const,
                                    layerResults: [],
                                    recommendation: "accept" as const,
                                    verifiedAt: new Date(),
                                  }),
                                ),
                              );

                            return {
                              ...c,
                              agentState: "verifying" as const,
                              metadata: {
                                ...c.metadata,
                                verificationResult: result,
                                verificationScore: result.overallScore,
                              },
                            };
                          }

                          return c;
                        }),
                      );
                    }

                    // If still rejected after retry, log warning and continue
                    const vResultAfterRetry = ctx.metadata.verificationResult as
                      | { passed?: boolean; recommendation?: string; overallScore?: number }
                      | undefined;
                    if (vResultAfterRetry && vResultAfterRetry.passed === false) {
                      if (obs) {
                        yield* obs.info(
                          `⚠ [verify] Response still rejected after ${vRetryCount + 1} retry(s) (score: ${vResultAfterRetry.overallScore?.toFixed(2) ?? "?"}) — proceeding anyway`,
                        ).pipe(Effect.catchAll(() => Effect.void));
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

                  const memoryFlushEffect = guardedPhase(ctx, "memory-flush", (c) =>
                    Effect.gen(function* () {
                      // ── Guard: skip entirely when no memory services are configured ──
                      const memoryServiceOpt = yield* Effect.serviceOption(
                        Context.GenericTag<{
                          snapshot: (s: unknown) => Effect.Effect<void>;
                          flush?: (agentId: string) => Effect.Effect<void>;
                        }>("MemoryService"),
                      );
                      const memoryConsolidatorOpt = yield* Effect.serviceOption(
                        Context.GenericTag<{
                          decayUnused: (agentId: string, decayFactor: number) => Effect.Effect<number>;
                        }>("MemoryConsolidator"),
                      );
                      const memoryExtractorOpt = yield* Effect.serviceOption(
                        Context.GenericTag<{
                          extractFromConversation: (
                            agentId: string,
                            messages: readonly { role: string; content: string }[],
                          ) => Effect.Effect<unknown[], unknown>;
                        }>("MemoryExtractor"),
                      );
                      if (
                        memoryServiceOpt._tag === "None" &&
                        memoryConsolidatorOpt._tag === "None" &&
                        memoryExtractorOpt._tag === "None"
                      ) {
                        return { ...c, agentState: "flushing" as const };
                      }

                      // ── Guard: skip on trivial runs (≤1 iteration, no tool calls) ──
                      const hadToolCalls = c.toolResults.length > 0;
                      if (c.iteration <= 1 && !hadToolCalls) {
                        return { ...c, agentState: "flushing" as const };
                      }

                      // ── MemoryService: snapshot + flush ──
                      yield* Effect.succeed(memoryServiceOpt).pipe(
                        Effect.flatMap((opt) =>
                          opt._tag === "Some"
                            ? Effect.gen(function* () {
                                yield* opt.value.snapshot({
                                  id: c.sessionId,
                                  agentId: c.agentId,
                                  messages: c.messages,
                                  summary: String(c.metadata.lastResponse ?? ""),
                                  keyDecisions: [],
                                  taskIds: [c.taskId],
                                  startedAt: c.startedAt,
                                  endedAt: new Date(),
                                  totalCost: c.cost,
                                  totalTokens: c.tokensUsed,
                                });
                                // H5: flush(agentId) writes the memory.md projection to disk
                                if (opt.value.flush) {
                                  yield* opt.value
                                    .flush(c.agentId)
                                    .pipe(Effect.catchAll(() => Effect.void));
                                }
                              })
                            : Effect.void,
                        ),
                        Effect.catchAll(() => Effect.void),
                      );

                      // Lightweight consolidation: decay unused memory entries
                      yield* Effect.succeed(memoryConsolidatorOpt).pipe(
                        Effect.flatMap((opt) =>
                          opt._tag === "Some"
                            ? opt.value
                                .decayUnused(c.agentId, 0.05)
                                .pipe(Effect.catchAll(() => Effect.succeed(0)))
                            : Effect.succeed(0),
                        ),
                        Effect.catchAll(() => Effect.succeed(0)),
                      );

                      // ── Auto-extract semantic memories ──
                      // Only extract when there's meaningful content:
                      // tool calls happened OR response is substantial (>200 chars)
                      const lastResponse = String(c.metadata.lastResponse ?? "");
                      const substantialResponse = lastResponse.length > 200;

                      if (hadToolCalls || substantialResponse) {
                        yield* Effect.succeed(memoryExtractorOpt).pipe(
                          Effect.flatMap((extractorOpt) => {
                            if (extractorOpt._tag !== "Some") return Effect.void;
                            const extractor = extractorOpt.value;

                            // Build messages from the execution context
                            const messages: { role: string; content: string }[] = [];
                            // Add the task input as user message
                            messages.push({ role: "user", content: String(task.input).slice(0, 1000) });
                            // Add tool results as context
                            for (const tr of c.toolResults) {
                              const toolResult = tr as { toolName?: string; result?: unknown };
                              messages.push({
                                role: "assistant",
                                content: `Tool ${toolResult.toolName ?? "unknown"}: ${String(toolResult.result ?? "").slice(0, 500)}`,
                              });
                            }
                            // Add the final response
                            if (lastResponse) {
                              messages.push({ role: "assistant", content: lastResponse.slice(0, 2000) });
                            }

                            return Effect.gen(function* () {
                              const entries = yield* extractor.extractFromConversation(c.agentId, messages);

                              // Store extracted semantic entries via MemoryService
                              if (entries.length > 0) {
                                const memStoreOpt = yield* Effect.serviceOption(
                                  Context.GenericTag<{
                                    storeSemantic: (entry: unknown) => Effect.Effect<unknown>;
                                  }>("MemoryService"),
                                ).pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));

                                if (memStoreOpt._tag === "Some") {
                                  for (const entry of entries) {
                                    yield* memStoreOpt.value
                                      .storeSemantic(entry)
                                      .pipe(Effect.catchAll(() => Effect.void));
                                  }
                                }
                              }
                            });
                          }),
                          Effect.catchAll(() => Effect.void),
                        );
                      }

                      return { ...c, agentState: "flushing" as const };
                    }),
                  );

                  if (complexity === "trivial") {
                    // Skip memory-flush entirely for trivial tasks
                    ctx = { ...ctx, agentState: "flushing" as const };
                  } else if (complexity === "moderate") {
                    // Fire-and-forget: fork the flush as a daemon fiber
                    yield* Effect.forkDaemon(memoryFlushEffect);
                  } else {
                    // Full blocking pipeline for complex tasks
                    ctx = yield* memoryFlushEffect;
                  }
                }

                // ── Phase 8: COST_TRACK (optional) ── H2
                if (config.enableCostTracking) {
                  ctx = yield* guardedPhase(ctx, "cost-track", (c) =>
                    Effect.gen(function* () {
                      const costOpt = yield* Effect.serviceOption(CostService).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({ _tag: "None" as const }),
                        ),
                      );

                      if (costOpt._tag === "Some") {
                        yield* costOpt.value
                          .recordCost({
                            agentId: c.agentId,
                            sessionId: c.sessionId,
                            model: String(c.selectedModel ?? "unknown"),
                            tier: "sonnet" as const,
                            inputTokens: 0,
                            outputTokens: c.tokensUsed,
                            cost: c.cost,
                            cachedHit: cacheHit,
                            taskType: task.type,
                            latencyMs: Date.now() - c.startedAt.getTime(),
                          })
                          .pipe(Effect.catchAll(() => Effect.void));
                      }

                      return c;
                    }),
                  );
                }

                // ── Phase 9: AUDIT (optional) ── H2
                if (config.enableAudit) {
                  ctx = yield* guardedPhase(ctx, "audit", (c) =>
                    Effect.gen(function* () {
                      if (obs) {
                        yield* obs.info("Execution audit trail", {
                          taskId: c.taskId,
                          agentId: c.agentId,
                          iterations: c.iteration,
                          tokensUsed: c.tokensUsed,
                          cost: c.cost,
                          strategy: c.selectedStrategy,
                          duration: Date.now() - c.startedAt.getTime(),
                          phase: "audit",
                        }).pipe(Effect.catchAll(() => Effect.void));
                      }
                      return c;
                    }),
                  );
                }

                // ── Phase 10: COMPLETE ──
                ctx = yield* guardedPhase(ctx, "complete", (c) =>
                  Effect.gen(function* () {
                    return { ...c, agentState: "completed" as const };
                  }),
                );

                // Build TaskResult — sanitize output to strip internal metadata
                const rr = ctx.metadata.reasoningResult as {
                  output?: unknown;
                  status?: string;
                  steps?: ReadonlyArray<{ type?: string; content?: string }>;
                  metadata?: { confidence?: number; strategyFallback?: boolean; terminatedBy?: string; finalAnswerCapture?: unknown };
                } | undefined;
                let rawOutput: unknown = ctx.metadata.lastResponse ?? null;
                if (
                  (rawOutput === null || rawOutput === "") &&
                  rr?.steps &&
                  rr.steps.length > 0
                ) {
                  const lastObs = [...rr.steps].reverse().find((s) => s.type === "observation");
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
                  }).pipe(Effect.catchAll(() => Effect.void));
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
                const taskComplexityForDebrief = (ctx.metadata.taskComplexity as TaskComplexity | undefined) ?? "complex";
                const debrief: AgentDebrief | undefined = yield* (rr !== undefined && config.enableMemory && taskComplexityForDebrief === "complex"
                  ? Effect.serviceOption(
                      Context.GenericTag<{ complete: (req: unknown) => Effect.Effect<unknown> }>("LLMService"),
                    ).pipe(
                      Effect.flatMap((llmOpt) => {
                        if (llmOpt._tag !== "Some") return Effect.succeed(undefined as AgentDebrief | undefined);
                        return synthesizeDebrief(debriefInput).pipe(
                          Effect.map((d) => d as AgentDebrief),
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
                      }).pipe(Effect.catchAll(() => Effect.void));
                    }),
                    Effect.catchAll(() => Effect.void),
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
                    llmCalls: (rr as any)?.metadata?.llmCalls ?? 0,
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
                  }).pipe(Effect.catchAll(() => Effect.void));
                }

                if (obs && isNormal) {
                  const durationSec = (result.metadata.duration / 1000).toFixed(1);
                  const costStr = `$${result.metadata.cost.toFixed(4)}`;
                  const toks = ctx.tokensUsed.toLocaleString();
                  yield* obs.info(
                    `◉ [complete]   ✓ ${task.id} | ${toks} tok | ${costStr} | ${durationSec}s`,
                  ).pipe(Effect.catchAll(() => Effect.void));
                }

                // Record final metrics for dashboard
                if (obs) {
                  yield* obs.setGauge("execution.tokens_used", ctx.tokensUsed, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll(() => Effect.void));
                  yield* obs.setGauge("execution.total_duration", result.metadata.duration, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll(() => Effect.void));
                  yield* obs.setGauge("execution.iteration", ctx.iteration, { taskId: ctx.taskId })
                    .pipe(Effect.catchAll(() => Effect.void));

                  // Record model used (updated to actual model from LLM provider response)
                  const modelName = String(ctx.selectedModel ?? "unknown");
                  const provider = String(config.provider ?? "unknown");

                  yield* obs.incrementCounter("execution.model_name", 0, { model: modelName, provider, taskId: ctx.taskId })
                    .pipe(Effect.catchAll(() => Effect.void));
                }

                // ── Record entropy metrics for dashboard ──
                if (obs && entropyLog.length > 0) {
                  for (const pt of entropyLog) {
                    yield* obs.setGauge("entropy.composite", pt.composite, {
                      taskId: ctx.taskId,
                      iteration: String(pt.iteration),
                      shape: pt.trajectory.shape,
                      confidence: pt.confidence,
                    }).pipe(Effect.catchAll(() => Effect.void));
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
                      const modelEntry = lookupModelFn(modelId);
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
                      });
                    }
                  } catch {
                    // Telemetry must never affect agent — silent failure
                  }
                }

                // ── Local Learning: update calibration, bandit, and skill store ──
                if (config.enableReactiveIntelligence && entropyLog.length > 0) {
                  yield* Effect.serviceOption(
                    Context.GenericTag<{
                      onRunCompleted: (data: any) => Effect.Effect<any, never>;
                    }>("LearningEngineService"),
                  ).pipe(
                    Effect.flatMap((opt) => {
                      if (opt._tag !== "Some") return Effect.void;
                      return opt.value.onRunCompleted({
                        modelId: String(ctx.selectedModel ?? config.defaultModel ?? "unknown"),
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
                    }),
                    Effect.catchAll(() => Effect.void),
                  );
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
                  }).pipe(Effect.catchAll(() => Effect.void));
                  yield* eb.publish({
                    _tag: "TaskCompleted",
                    taskId: task.id,
                    success: executionSucceeded,
                  }).pipe(Effect.catchAll(() => Effect.void));
                }

                // Attach entropy trace to result metadata for dashboard consumption
                if (entropyLog.length > 0) {
                  (result.metadata as any).entropyTrace = entropyLog;
                }

                return result;
              });

            // Wrap in root observability span for the full execution trace
            // The cast is required because executeCore has service requirements from Effect.gen,
            // but they will be satisfied by Effect.provide(runtime) in the builder.
            if (obs) {
              const taskResult = yield* obs.withSpan(
                "execution.run",
                executeCore() as unknown as Effect.Effect<TaskResult, RuntimeErrors>,
                { taskId: task.id, agentId: task.agentId },
              );
              // Flush after the root span closes so spans are fully recorded
              yield* obs.flush().pipe(Effect.catchAll(() => Effect.void));
              return taskResult;
            }
            return yield* executeCore();
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
              } as AgentEvent).pipe(Effect.catchAll(() => Effect.void));
            }

            // Subscribe to ReasoningIterationProgress events — push them as IterationProgress stream events
            if (eb) {
              yield* eb.on("ReasoningIterationProgress", (event) =>
                Queue.offer(queue, {
                  _tag: "IterationProgress",
                  iteration: event.iteration,
                  maxIterations: event.maxIterations,
                  toolsCalledThisStep: event.toolsThisStep,
                  status: `iteration ${event.iteration}/${event.maxIterations}`,
                } as AgentStreamEvent).pipe(Effect.catchAll(() => Effect.void)),
              ).pipe(Effect.catchAll(() => Effect.void));
            }

            // Fork execution within the Effect context (services available).
            // Events are pushed to the queue; no Queue.shutdown (preserves items).
            yield* Effect.locally(
              execute(task).pipe(
                Effect.tap((taskResult) => {
                  // Build toolSummary from debrief.toolsUsed if available
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
                      } as AgentEvent).pipe(Effect.catchAll(() => Effect.void)),
                    ),
                  );
                }),
                Effect.catchAll((err: unknown) => {
                  const cause =
                    typeof err === "object" &&
                    err !== null &&
                    "message" in err
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
                      } as AgentEvent).pipe(Effect.catchAll(() => Effect.void)),
                    ),
                  );
                }),
              ),
              StreamingTextCallback,
              (text: string) =>
                Queue.offer(queue, { _tag: "TextDelta", text }).pipe(
                  Effect.map(() => {}),
                ),
            ).pipe(Effect.forkDaemon);

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
