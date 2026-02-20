import { Effect, Context, Layer, Ref } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "./types.js";
import {
  ExecutionError,
  MaxIterationsError,
  type RuntimeErrors,
} from "./errors.js";
import { LifecycleHookRegistry } from "./hooks.js";
import type { LifecycleHook } from "./types.js";

// Import from other packages (type-only to avoid circular deps at runtime)
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";

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

      const execute = (task: Task): Effect.Effect<TaskResult, RuntimeErrors> =>
        (Effect.gen(function* () {
          const now = new Date();
          const sessionId = `session-${Date.now()}`;

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
            startedAt: now,
            metadata: {},
          };

          // Register context as running
          yield* Ref.update(runningContexts, (m) =>
            new Map(m).set(task.id, ctx),
          );

          // ── Phase 1: BOOTSTRAP ──
          ctx = yield* runPhase(ctx, "bootstrap", (c) =>
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

          // ── Phase 2: GUARDRAIL (optional) ──
          if (config.enableGuardrails) {
            ctx = yield* runPhase(ctx, "guardrail", (c) =>
              Effect.succeed(c),
            );
          }

          // ── Phase 3: COST_ROUTE (optional) ──
          if (config.enableCostTracking) {
            ctx = yield* runPhase(ctx, "cost-route", (c) =>
              Effect.succeed({ ...c, selectedModel: config.defaultModel }),
            );
          }

          // ── Phase 4: STRATEGY_SELECT ──
          ctx = yield* runPhase(ctx, "strategy-select", (c) =>
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
            ctx = yield* runPhase(ctx, "think", (c) =>
              Effect.gen(function* () {
                const result = yield* reasoningOpt.value.execute({
                  taskDescription: JSON.stringify(task.input),
                  taskType: task.type,
                  memoryContext: String(
                    (c.memoryContext as any)?.semanticContext ?? "",
                  ),
                  availableTools: [],
                  strategy: c.selectedStrategy ?? "reactive",
                });
                return {
                  ...c,
                  cost: c.cost + (result.metadata.cost ?? 0),
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
            let isComplete = false;

            while (!isComplete && ctx.iteration < ctx.maxIterations) {
              // 5a. THINK
              ctx = yield* runPhase(ctx, "think", (c) =>
                (Effect.gen(function* () {
                  const llm = yield* Context.GenericTag<{
                    complete: (
                      req: unknown,
                    ) => Effect.Effect<{
                      content: string;
                      toolCalls?: unknown[];
                      stopReason: string;
                    }>;
                  }>("LLMService");

                  const systemPrompt = c.memoryContext
                    ? `${String((c.memoryContext as any).semanticContext ?? "")}\n\nComplete the task: ${JSON.stringify(task.input)}`
                    : `Complete the task: ${JSON.stringify(task.input)}`;

                  const response = yield* llm.complete({
                    messages: c.messages,
                    systemPrompt,
                    model: c.selectedModel,
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
                    metadata: {
                      ...c.metadata,
                      lastResponse: response.content,
                      pendingToolCalls: response.toolCalls ?? [],
                      isComplete: done,
                    },
                  };
                }) as unknown as Effect.Effect<ExecutionContext, never>),
              );

              // 5b. ACT (if tool calls present)
              const pendingCalls =
                (ctx.metadata.pendingToolCalls as unknown[]) ?? [];
              if (pendingCalls.length > 0) {
                ctx = yield* runPhase(ctx, "act", (c) =>
                  Effect.gen(function* () {
                    const toolResults: unknown[] = pendingCalls.map(
                      (call: any) => ({
                        toolCallId: call.id ?? "unknown",
                        toolName: call.name ?? "unknown",
                        result: `[Tool ${call.name} executed]`,
                        durationMs: 0,
                      }),
                    );

                    return {
                      ...c,
                      toolResults: [...c.toolResults, ...toolResults],
                    };
                  }),
                );

                // 5c. OBSERVE
                ctx = yield* runPhase(ctx, "observe", (c) =>
                  Effect.succeed({
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        role: "user",
                        content: c.toolResults
                          .slice(-pendingCalls.length)
                          .map(
                            (r: any) =>
                              `Tool result: ${JSON.stringify(r.result)}`,
                          )
                          .join("\n"),
                      },
                    ],
                    iteration: c.iteration + 1,
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

          // ── Phase 6: VERIFY (optional) ──
          if (config.enableVerification) {
            ctx = yield* runPhase(ctx, "verify", (c) => Effect.succeed(c));
          }

          // ── Phase 7: MEMORY_FLUSH ──
          ctx = yield* runPhase(ctx, "memory-flush", (c) =>
            Effect.gen(function* () {
              yield* Effect.serviceOption(
                Context.GenericTag<{
                  snapshot: (s: unknown) => Effect.Effect<void>;
                }>("MemoryService"),
              ).pipe(
                Effect.flatMap((opt) =>
                  opt._tag === "Some"
                    ? opt.value.snapshot({
                        id: c.sessionId,
                        agentId: c.agentId,
                        messages: c.messages,
                        summary: String(c.metadata.lastResponse ?? ""),
                        keyDecisions: [],
                        taskIds: [c.taskId],
                        startedAt: c.startedAt,
                        endedAt: new Date(),
                        totalCost: c.cost,
                        totalTokens: 0,
                      })
                    : Effect.void,
                ),
                Effect.catchAll(() => Effect.void),
              );

              return { ...c, agentState: "flushing" as const };
            }),
          );

          // ── Phase 8: COST_TRACK (optional) ──
          if (config.enableCostTracking) {
            ctx = yield* runPhase(ctx, "cost-track", (c) =>
              Effect.succeed(c),
            );
          }

          // ── Phase 9: AUDIT (optional) ──
          if (config.enableAudit) {
            ctx = yield* runPhase(ctx, "audit", (c) => Effect.succeed(c));
          }

          // ── Phase 10: COMPLETE ──
          ctx = yield* runPhase(ctx, "complete", (c) =>
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
              tokensUsed: 0,
              strategyUsed: ctx.selectedStrategy,
              stepsCount: ctx.iteration,
            },
            completedAt: new Date(),
          };

          return result;
        }) as Effect.Effect<TaskResult, RuntimeErrors, any>).pipe(
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
