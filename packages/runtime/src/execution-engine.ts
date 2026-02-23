import { Effect, Context, Layer, Ref } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "./types.js";
import {
  ExecutionError,
  GuardrailViolationError,
  MaxIterationsError,
  type RuntimeErrors,
} from "./errors.js";
import { LifecycleHookRegistry } from "./hooks.js";
import type { LifecycleHook } from "./types.js";

// Import from other packages (type-only to avoid circular deps at runtime)
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import { ToolService } from "@reactive-agents/tools";
import { ObservabilityService } from "@reactive-agents/observability";
import { GuardrailService } from "@reactive-agents/guardrails";
import { VerificationService } from "@reactive-agents/verification";
import { CostService } from "@reactive-agents/cost";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

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
  on: (tag: AgentEvent["_tag"], handler: (event: AgentEvent) => Effect.Effect<void, never>) => Effect.Effect<() => void, never>;
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
  }
>() {}

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
      ): Effect.Effect<ExecutionContext, E | RuntimeErrors> =>
        Effect.gen(function* () {
          const ctxBefore = { ...ctx, phase };

          // Before hooks
          const ctxAfterBefore = yield* hookRegistry
            .run(phase, "before", ctxBefore)
            .pipe(Effect.catchAll(() => Effect.succeed(ctxBefore)));

          // Check cancellation
          const cancelled = yield* Ref.get(cancelledTasks);
          if (cancelled.has(ctx.taskId)) {
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

        const phaseEffect = runPhase(ctx, phase, body).pipe(
          // After phase completes: emit metrics + phase completed event
          Effect.tap((result) => {
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

      const execute = (task: Task): Effect.Effect<TaskResult, RuntimeErrors> =>
        (
          Effect.gen(function* () {
            const now = new Date();
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

            // ── Phase 0.2: Acquire EventBus optionally ──
            const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
              Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
            );
            const eb: EbLike | null = ebOpt._tag === "Some" ? ebOpt.value : null;

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
                  metadata: {},
                };

                // Register context as running
                yield* Ref.update(runningContexts, (m) =>
                  new Map(m).set(task.id, ctx),
                );

                if (obs) {
                  yield* obs.info("Execution started", {
                    taskId: task.id,
                    agentId: task.agentId,
                  }).pipe(Effect.catchAll(() => Effect.void));
                }

                // ── Phase 1: BOOTSTRAP ──
                ctx = yield* runObservablePhase(obs, eb, ctx, "bootstrap", (c) =>
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

                // ── Log bootstrap summary ──
                if (obs && isNormal) {
                  const bootstrapMs = Date.now() - now.getTime();
                  const mc = ctx.memoryContext as any;
                  const semanticCount = mc?.semanticResults?.length ?? 0;
                  const episodicCount = mc?.episodicSummary?.length ?? 0;
                  const memInfo = isVerbose
                    ? `${semanticCount} semantic, ${episodicCount} episodic`
                    : "memory loaded";
                  yield* obs.info(`◉ [bootstrap]  ${memInfo} | ${bootstrapMs}ms`)
                    .pipe(Effect.catchAll(() => Effect.void));
                }

                // ── Phase 2: GUARDRAIL (optional) ── H2
                if (config.enableGuardrails) {
                  ctx = yield* runObservablePhase(obs, eb, ctx, "guardrail", (c) =>
                    Effect.gen(function* () {
                      const guardrailOpt = yield* Effect.serviceOption(
                        GuardrailService,
                      ).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({ _tag: "None" as const }),
                        ),
                      );

                      if (guardrailOpt._tag === "Some") {
                        const inputText = String(
                          (task.input as any).question ??
                            JSON.stringify(task.input),
                        );
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
                  ctx = yield* runObservablePhase(obs, eb, ctx, "cost-route", (c) =>
                    Effect.gen(function* () {
                      const costOpt = yield* Effect.serviceOption(CostService).pipe(
                        Effect.catchAll(() =>
                          Effect.succeed({ _tag: "None" as const }),
                        ),
                      );

                      if (costOpt._tag === "Some") {
                        const taskDescription = String(
                          (task.input as any).question ??
                            JSON.stringify(task.input),
                        );
                        const modelConfig = yield* costOpt.value
                          .routeToModel(taskDescription)
                          .pipe(
                            Effect.catchAll(() =>
                              Effect.succeed({ model: config.defaultModel }),
                            ),
                          );
                        return {
                          ...c,
                          selectedModel:
                            (modelConfig as any).model ?? config.defaultModel,
                        };
                      }

                      return { ...c, selectedModel: config.defaultModel };
                    }),
                  );
                }

                // ── Phase 4: STRATEGY_SELECT ──
                ctx = yield* runObservablePhase(obs, eb, ctx, "strategy-select", (c) =>
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
                                taskDescription: JSON.stringify(task.input),
                                taskType: task.type,
                                complexity: 0.5,
                                urgency: 0.5,
                              },
                              c.memoryContext,
                            )
                            .pipe(Effect.catchAll(() => Effect.succeed("reactive")))
                        : "reactive";
                    return { ...c, selectedStrategy: strategy };
                  }),
                );

                // ── Log strategy-select summary ──
                if (obs && isNormal) {
                  const toolNames = yield* Effect.serviceOption(ToolService).pipe(
                    Effect.flatMap((opt) =>
                      opt._tag === "Some"
                        ? opt.value.listTools().pipe(
                            Effect.map((tools) => tools.map((t) => t.name).join(", ")),
                          )
                        : Effect.succeed(""),
                    ),
                    Effect.catchAll(() => Effect.succeed("")),
                  );
                  const toolsInfo = toolNames ? ` | tools: ${toolNames}` : "";
                  yield* obs.info(`◉ [strategy]   ${ctx.selectedStrategy ?? "reactive"}${toolsInfo}`)
                    .pipe(Effect.catchAll(() => Effect.void));
                }

                // ── Phase 5: AGENT_LOOP ──
                const reasoningOpt = yield* Effect.serviceOption(
                  Context.GenericTag<{
                    execute: (params: {
                      taskDescription: string;
                      taskType: string;
                      memoryContext: string;
                      availableTools: readonly string[];
                      strategy?: string;
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

                if (reasoningOpt._tag === "Some") {
                  // ── Full reasoning path ──
                  const availableToolNames = yield* Effect.serviceOption(
                    ToolService,
                  ).pipe(
                    Effect.flatMap((opt) =>
                      opt._tag === "Some"
                        ? opt.value
                            .listTools()
                            .pipe(
                              Effect.map(
                                (tools) => tools.map((t) => t.name) as string[],
                              ),
                            )
                        : Effect.succeed([] as string[]),
                    ),
                    Effect.catchAll(() => Effect.succeed([] as string[])),
                  );

                  // ── Subscribe to reasoning steps for live streaming ──
                  let unsubscribeReasoningSteps: (() => void) | null = null;
                  if (eb && obs && isVerbose) {
                    const capturedObs = obs;
                    const capturedIsDebug = isDebug;
                    unsubscribeReasoningSteps = yield* eb.on(
                      "ReasoningStepCompleted",
                      (event) => {
                        const e = event as Extract<AgentEvent, { _tag: "ReasoningStepCompleted" }>;
                        const prefix = e.thought
                          ? "┄ [thought]"
                          : e.action
                            ? "┄ [action] "
                            : "┄ [obs]    ";
                        const rawContent = e.thought ?? e.action ?? e.observation ?? "";
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

                  ctx = yield* runObservablePhase(obs, eb, ctx, "think", (c) =>
                    Effect.gen(function* () {
                      const result = yield* reasoningOpt.value.execute({
                        taskDescription: JSON.stringify(task.input),
                        taskType: task.type,
                        memoryContext: String(
                          (c.memoryContext as any)?.semanticContext ?? "",
                        ),
                        availableTools: availableToolNames,
                        strategy: c.selectedStrategy ?? "reactive",
                      });
                      return {
                        ...c,
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

                  // ── Log think summary ──
                  if (obs && isNormal) {
                    const thinkResult = ctx.metadata.reasoningResult as any;
                    const stepsCount = ctx.metadata.stepsCount as number ?? 0;
                    const tokTot = ctx.tokensUsed;
                    const thinkMs = thinkResult?.metadata?.duration ?? 0;
                    yield* obs.info(`◉ [think]      ${stepsCount} steps | ${tokTot.toLocaleString()} tok | ${(thinkMs / 1000).toFixed(1)}s`)
                      .pipe(Effect.catchAll(() => Effect.void));
                  }

                  // ── Fire "act" + "observe" phases if reasoning used tools ──
                  // Extract action steps from the reasoning result so hooks
                  // (e.g. .withHook({ phase: "act" })) have visibility into tool calls.
                  const reasoningSteps = (ctx.metadata.reasoningSteps ?? []) as Array<{
                    id: string;
                    type: string;
                    content: string;
                    metadata?: { toolUsed?: string; duration?: number };
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

                    const syntheticToolResults = actionSteps.map((s) => ({
                      toolName: s.metadata?.toolUsed ?? s.content.split("(")[0]?.trim() ?? "unknown",
                      toolCallId: s.id,
                      result: s.content,
                      durationMs: s.metadata?.duration ?? 0,
                    }));

                    ctx = { ...ctx, toolResults: syntheticToolResults };

                    ctx = yield* runObservablePhase(obs, eb, ctx, "act", (c) =>
                      Effect.succeed(c),
                    );
                    ctx = yield* runObservablePhase(obs, eb, ctx, "observe", (c) =>
                      Effect.succeed(c),
                    );
                  }

                  // Update iteration to reflect actual reasoning steps
                  ctx = {
                    ...ctx,
                    iteration: (ctx.metadata.stepsCount as number | undefined) ?? 1,
                  };
                } else {
                  // ── Minimal direct-LLM loop ──
                  // Seed messages with the user's prompt before the first LLM call
                  ctx = {
                    ...ctx,
                    messages: [
                      {
                        role: "user",
                        content: String(
                          (task.input as any).question ??
                            JSON.stringify(task.input),
                        ),
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

                  while (!isComplete && ctx.iteration <= ctx.maxIterations) {
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
                    ctx = yield* runObservablePhase(
                      obs,
                      eb,
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

                          const llmCallStart = performance.now();
                          const response = yield* llm.complete(llmRequest);
                          const llmDurationMs = performance.now() - llmCallStart;

                          // Phase 0.2: Publish LLMRequestCompleted event
                          if (eb) {
                            yield* eb.publish({
                              _tag: "LLMRequestCompleted",
                              taskId: c.taskId,
                              requestId: `req-${Date.now()}`,
                              model: String((c.selectedModel as any)?.model ?? c.selectedModel ?? "unknown"),
                              provider: String((c.selectedModel as any)?.provider ?? "unknown"),
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
                              { model: String((c.selectedModel as any)?.model ?? "unknown") },
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
                                  model: String((c.selectedModel as any)?.model ?? c.selectedModel ?? "unknown"),
                                  messageCount: messagesToSend.length,
                                  tokensUsed: response.usage?.totalTokens ?? 0,
                                  durationMs: llmDurationMs,
                                },
                              } as any)
                              .pipe(Effect.catchAll(() => Effect.void));
                          }

                          const updatedMessages = [
                            ...c.messages,
                            { role: "assistant", content: response.content },
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

                    // 5b. ACT (if tool calls present) — call real ToolService
                    const pendingCalls =
                      (ctx.metadata.pendingToolCalls as unknown[]) ?? [];
                    if (pendingCalls.length > 0) {
                      ctx = yield* runObservablePhase(obs, eb, ctx, "act", (c) =>
                        Effect.gen(function* () {
                          const toolServiceOpt =
                            yield* Effect.serviceOption(ToolService);

                          const toolResults: unknown[] = yield* Effect.all(
                            pendingCalls.map((call: any) =>
                              Effect.gen(function* () {
                                const callId = call.id ?? "unknown";
                                const toolName =
                                  call.name ?? call.function?.name ?? "unknown";
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

                      // 5c. OBSERVE — H5: also log episodic memories
                      ctx = yield* runObservablePhase(obs, eb, ctx, "observe", (c) =>
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
                              const resultStr = typeof (r as any).result === "string"
                                ? (r as any).result as string
                                : JSON.stringify((r as any).result);
                              const preview = resultStr.length > 120 ? resultStr.slice(0, 120) + "..." : resultStr;
                              const charCount = resultStr.length;
                              yield* obs.debug(
                                `  ┄ [obs]    ${(r as any).toolName}: ${preview} [${charCount} chars]`,
                              ).pipe(Effect.catchAll(() => Effect.void));
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

                          return {
                            ...c,
                            messages: [...c.messages, ...toolResultMessages],
                            iteration: c.iteration + 1,
                          };
                        }),
                      );
                    } else {
                      // 5d. LOOP_CHECK
                      isComplete = Boolean(ctx.metadata.isComplete);
                      ctx = { ...ctx, iteration: ctx.iteration + 1 };
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
                  ctx = yield* runObservablePhase(obs, eb, ctx, "verify", (c) =>
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
                        const input = String(
                          (task.input as any).question ??
                            JSON.stringify(task.input),
                        );
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

                // ── Phase 7: MEMORY_FLUSH ── H5
                ctx = yield* runObservablePhase(obs, eb, ctx, "memory-flush", (c) =>
                  Effect.gen(function* () {
                    yield* Effect.serviceOption(
                      Context.GenericTag<{
                        snapshot: (s: unknown) => Effect.Effect<void>;
                        flush?: () => Effect.Effect<void>;
                      }>("MemoryService"),
                    ).pipe(
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
                              // H5: Call flush() to generate memory.md projection
                              if (opt.value.flush) {
                                yield* opt.value
                                  .flush()
                                  .pipe(Effect.catchAll(() => Effect.void));
                              }
                            })
                          : Effect.void,
                      ),
                      Effect.catchAll(() => Effect.void),
                    );

                    return { ...c, agentState: "flushing" as const };
                  }),
                );

                // ── Phase 8: COST_TRACK (optional) ── H2
                if (config.enableCostTracking) {
                  ctx = yield* runObservablePhase(obs, eb, ctx, "cost-track", (c) =>
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
                            cachedHit: false,
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
                  ctx = yield* runObservablePhase(obs, eb, ctx, "audit", (c) =>
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
                ctx = yield* runObservablePhase(obs, eb, ctx, "complete", (c) =>
                  Effect.succeed({ ...c, agentState: "completed" as const }),
                );

                // Build TaskResult
                const result: TaskResult = {
                  taskId: task.id as any,
                  agentId: task.agentId,
                  output: ctx.metadata.lastResponse ?? null,
                  success: true,
                  metadata: {
                    duration: Date.now() - ctx.startedAt.getTime(),
                    cost: ctx.cost,
                    tokensUsed: ctx.tokensUsed,
                    strategyUsed: ctx.selectedStrategy,
                    stepsCount: (ctx.metadata.stepsCount as number | undefined) ?? ctx.iteration,
                  },
                  completedAt: new Date(),
                };

                if (obs) {
                  yield* obs.info("Execution completed", {
                    taskId: task.id,
                    success: true,
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

                // Phase 0.2: Publish TaskCompleted
                if (eb) {
                  yield* eb.publish({
                    _tag: "TaskCompleted",
                    taskId: task.id,
                    success: true,
                  }).pipe(Effect.catchAll(() => Effect.void));
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
      };
    }),
  );
