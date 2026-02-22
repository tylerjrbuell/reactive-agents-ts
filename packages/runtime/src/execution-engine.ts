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
       * H1: Observable phase wrapper — wraps runPhase in observability span
       * when ObservabilityService is available.
       */
      const runObservablePhase = <E>(
        obs: { withSpan: <A, E2>(name: string, effect: Effect.Effect<A, E2>, attrs?: Record<string, unknown>) => Effect.Effect<A, E2> } | null,
        ctx: ExecutionContext,
        phase: ExecutionContext["phase"],
        body: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, E>,
      ): Effect.Effect<ExecutionContext, E | RuntimeErrors> => {
        const phaseEffect = runPhase(ctx, phase, body);
        if (!obs) return phaseEffect;
        return obs.withSpan(
          `execution.phase.${phase}`,
          phaseEffect.pipe(
            Effect.tap((result) =>
              obs.withSpan(`phase.${phase}.metrics`, Effect.void, {
                iteration: result.iteration,
                tokensUsed: result.tokensUsed,
                cost: result.cost,
              }),
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
            const obsOpt = yield* Effect.serviceOption(ObservabilityService).pipe(
              Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
            );
            const obs = obsOpt._tag === "Some" ? obsOpt.value : null;

            // Initialize context
            let ctx: ExecutionContext = {
              taskId: task.id,
              agentId: task.agentId,
              sessionId,
              phase: "bootstrap",
              agentState: "bootstrapping",
              iteration: 0,
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
              });
            }

            // ── Phase 1: BOOTSTRAP ──
            ctx = yield* runObservablePhase(obs, ctx, "bootstrap", (c) =>
              Effect.gen(function* () {
                // MemoryService is optional — skip if not provided
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

            // ── Phase 2: GUARDRAIL (optional) ── H2
            if (config.enableGuardrails) {
              ctx = yield* runObservablePhase(obs, ctx, "guardrail", (c) =>
                Effect.gen(function* () {
                  const guardrailOpt = yield* Effect.serviceOption(GuardrailService).pipe(
                    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                  );

                  if (guardrailOpt._tag === "Some") {
                    const inputText = String(
                      (task.input as any).question ?? JSON.stringify(task.input),
                    );
                    const result = yield* guardrailOpt.value
                      .check(inputText)
                      .pipe(Effect.catchAll(() => Effect.succeed({ passed: true, violations: [], score: 1, checkedAt: new Date() })));

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
              ctx = yield* runObservablePhase(obs, ctx, "cost-route", (c) =>
                Effect.gen(function* () {
                  const costOpt = yield* Effect.serviceOption(CostService).pipe(
                    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                  );

                  if (costOpt._tag === "Some") {
                    const taskDescription = String(
                      (task.input as any).question ?? JSON.stringify(task.input),
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
                      selectedModel: (modelConfig as any).model ?? config.defaultModel,
                    };
                  }

                  return { ...c, selectedModel: config.defaultModel };
                }),
              );
            }

            // ── Phase 4: STRATEGY_SELECT ──
            ctx = yield* runObservablePhase(obs, ctx, "strategy-select", (c) =>
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
              // Collect real tool names from ToolService if present
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

              ctx = yield* runObservablePhase(obs, ctx, "think", (c) =>
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
                    tokensUsed: c.tokensUsed + (result.metadata.tokensUsed ?? 0),
                    metadata: {
                      ...c.metadata,
                      lastResponse: String(result.output ?? ""),
                      isComplete: result.status === "completed",
                      reasoningResult: result,
                      stepsCount: result.metadata.stepsCount,
                    },
                  };
                }),
              );
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

              // H3: Get ContextWindowManager for message truncation
              const contextManagerOpt = yield* Effect.serviceOption(
                Context.GenericTag<{
                  truncate: (
                    messages: readonly unknown[],
                    targetTokens: number,
                    strategy: string,
                  ) => Effect.Effect<readonly unknown[], unknown>;
                }>("ContextWindowManager"),
              ).pipe(
                Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
              );

              let isComplete = false;

              while (!isComplete && ctx.iteration < ctx.maxIterations) {
                // H3: Truncate messages if ContextWindowManager is available
                let messagesToSend = ctx.messages as unknown[];
                if (contextManagerOpt._tag === "Some") {
                  messagesToSend = yield* contextManagerOpt.value
                    .truncate([...ctx.messages], 100_000, "drop-oldest")
                    .pipe(
                      Effect.map((msgs) => [...msgs]),
                      Effect.catchAll(() => Effect.succeed([...ctx.messages] as unknown[])),
                    );
                }

                // 5a. THINK
                ctx = yield* runObservablePhase(
                  obs,
                  ctx,
                  "think",
                  (c) =>
                    Effect.gen(function* () {
                      const llm = yield* Context.GenericTag<{
                        complete: (req: unknown) => Effect.Effect<{
                          content: string;
                          toolCalls?: unknown[];
                          stopReason: string;
                          usage?: { totalTokens?: number; estimatedCost?: number };
                        }>;
                      }>("LLMService");

                      const defaultPrompt = config.systemPrompt ?? "You are a helpful AI assistant.";
                      const systemPrompt = c.memoryContext
                        ? `${String((c.memoryContext as any).semanticContext ?? "")}\n\n${defaultPrompt}`
                        : defaultPrompt;

                      // Convert function-calling tools to LLM ToolDefinition format
                      const llmTools = functionCallingTools.length > 0
                        ? functionCallingTools.map((t: any) => ({
                            name: t.name,
                            description: t.description,
                            inputSchema: t.input_schema,
                          }))
                        : undefined;

                      const response = yield* llm.complete({
                        messages: messagesToSend,
                        systemPrompt,
                        model: c.selectedModel,
                        ...(llmTools ? { tools: llmTools } : {}),
                      });

                      const updatedMessages = [
                        ...c.messages,
                        { role: "assistant", content: response.content },
                      ];

                      const done =
                        response.stopReason === "end_turn" &&
                        !response.toolCalls?.length;

                      return {
                        ...c,
                        messages: updatedMessages,
                        tokensUsed: c.tokensUsed + (response.usage?.totalTokens ?? 0),
                        cost: c.cost + (response.usage?.estimatedCost ?? 0),
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
                  ctx = yield* runObservablePhase(obs, ctx, "act", (c) =>
                    Effect.gen(function* () {
                      const toolServiceOpt =
                        yield* Effect.serviceOption(ToolService);

                      const toolResults: unknown[] = yield* Effect.all(
                        pendingCalls.map((call: any) =>
                          Effect.gen(function* () {
                            const callId = call.id ?? "unknown";
                            const toolName =
                              call.name ?? call.function?.name ?? "unknown";
                            // LLM providers may return args as a JSON string (OpenAI) or object
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

                            if (toolServiceOpt._tag === "None") {
                              return {
                                toolCallId: callId,
                                toolName,
                                result: `[ToolService not available — add .withTools() to agent builder]`,
                                durationMs: 0,
                              };
                            }

                            return yield* toolServiceOpt.value
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
                                })),
                                Effect.catchAll((e) =>
                                  Effect.succeed({
                                    toolCallId: callId,
                                    toolName,
                                    result: `[Tool error: ${e instanceof Error ? e.message : String(e)}]`,
                                    durationMs: Date.now() - startMs,
                                  }),
                                ),
                              );
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
                  ctx = yield* runObservablePhase(obs, ctx, "observe", (c) =>
                    Effect.gen(function* () {
                      const recentResults = c.toolResults.slice(-pendingCalls.length);

                      // H5: Log tool results as episodic memory items
                      const memOpt = yield* Effect.serviceOption(
                        Context.GenericTag<{
                          logEpisode: (episode: unknown) => Effect.Effect<void>;
                        }>("MemoryService"),
                      ).pipe(
                        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                      );

                      if (memOpt._tag === "Some") {
                        for (const r of recentResults) {
                          yield* memOpt.value
                            .logEpisode({
                              type: "tool_result",
                              toolName: (r as any).toolName,
                              result: (r as any).result,
                              taskId: c.taskId,
                              timestamp: new Date(),
                            })
                            .pipe(Effect.catchAll(() => Effect.void));
                        }
                      }

                      // Emit structured tool result messages with toolCallId references
                      // LLM provider adapters translate these to their native format:
                      // - Anthropic: { type: "tool_result", tool_use_id, content }
                      // - OpenAI: { role: "tool", tool_call_id, content }
                      const toolResultMessages = recentResults.map((r: any) => ({
                        role: "tool" as const,
                        toolCallId: r.toolCallId,
                        content: typeof r.result === "string" ? r.result : JSON.stringify(r.result),
                      }));

                      return {
                        ...c,
                        messages: [
                          ...c.messages,
                          ...toolResultMessages,
                        ],
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
            }

            // ── Phase 6: VERIFY (optional) ── H2
            if (config.enableVerification) {
              ctx = yield* runObservablePhase(obs, ctx, "verify", (c) =>
                Effect.gen(function* () {
                  const verifyOpt = yield* Effect.serviceOption(VerificationService).pipe(
                    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
                  );

                  if (verifyOpt._tag === "Some") {
                    const response = String(c.metadata.lastResponse ?? "");
                    const input = String(
                      (task.input as any).question ?? JSON.stringify(task.input),
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
            ctx = yield* runObservablePhase(obs, ctx, "memory-flush", (c) =>
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
                            yield* opt.value.flush().pipe(
                              Effect.catchAll(() => Effect.void),
                            );
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
              ctx = yield* runObservablePhase(obs, ctx, "cost-track", (c) =>
                Effect.gen(function* () {
                  const costOpt = yield* Effect.serviceOption(CostService).pipe(
                    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
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
              ctx = yield* runObservablePhase(obs, ctx, "audit", (c) =>
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
                    });
                  }
                  return c;
                }),
              );
            }

            // ── Phase 10: COMPLETE ──
            ctx = yield* runObservablePhase(obs, ctx, "complete", (c) =>
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
                stepsCount: ctx.iteration,
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
              });
            }

            return result;
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
