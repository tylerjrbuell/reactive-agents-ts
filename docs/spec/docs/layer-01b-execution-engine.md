# Layer 1B: Execution Engine - AI Agent Implementation Spec

## Overview

The `@reactive-agents/runtime` package defines **HOW a task actually executes**. It provides the
concrete agent loop that orchestrates all other services into a working execution pipeline.
`AgentService` creates agents, `TaskService` creates tasks — `ExecutionEngine` runs them.

**Package:** `@reactive-agents/runtime`
**Dependencies:** ALL other packages (this is the top-level orchestrator)
**Phase:** 1C (after Core and LLM Provider, concurrent with Memory)

This is the 16th monorepo package. `@reactive-agents/core` stays a pure foundation with
**no upward dependencies** — ExecutionEngine lives here, not in core.

---

## The Agent Loop (10 Phases)

```
Task.create()
  → ExecutionEngine.execute(task)
    → Phase 1: BOOTSTRAP
        MemoryService.bootstrap(agentId) → injects semantic + episodic + procedural context
    → Phase 2: GUARDRAIL
        GuardrailService.check(task.input) → throws GuardrailViolationError if fails
    → Phase 3: COST_ROUTE
        CostRouter.selectModel(task) → returns ModelConfig for this task
    → Phase 4: STRATEGY_SELECT
        StrategySelector.select(task, memoryContext) → returns ReasoningStrategy
    → Phase 5: AGENT_LOOP (repeats until isComplete or maxIterations)
        5a. THINK: LLMService.complete(messages + context) → thought + action/finalAnswer
        5b. ACT:   ToolService.execute(toolCall) → observation (if action present)
        5c. OBSERVE: append observation to messages
        5d. LOOP_CHECK: if thought.isComplete → exit loop
    → Phase 6: VERIFY
        VerificationService.verify(result) → confidence score
    → Phase 7: MEMORY_FLUSH
        MemoryExtractor.evaluate(conversation) → conditionally writes to SQLite
        MemoryService.snapshot(sessionId, messages) → session snapshot
    → Phase 8: COST_TRACK
        CostTracker.record(taskId, usage) → updates budget
    → Phase 9: AUDIT
        AuditService.log(taskId, agentId, result) → immutable audit entry
    → Phase 10: COMPLETE
        EventBus.publish({ type: "task.completed", taskId, result })
        return TaskResult
```

**Note:** Phases 2, 3, 6, 7, 8, 9 are **optional** — skipped if the corresponding service layer is
not provided. The minimal runtime (Phase 1 only) requires: Core + LLM Provider + Memory.

---

## Package Structure

```
@reactive-agents/runtime/
├── src/
│   ├── index.ts                    # Public API re-exports
│   ├── types.ts                    # ExecutionContext, LifecyclePhase, AgentState schemas
│   ├── errors.ts                   # ExecutionError, HookError, RuntimeError
│   ├── hooks.ts                    # LifecycleHookRegistry service
│   ├── execution-engine.ts         # ExecutionEngine Context.Tag + ExecutionEngineLive
│   ├── runtime.ts                  # ReactiveAgentsRuntime (composes ALL package layers)
│   └── builder.ts                  # ReactiveAgentBuilder + ReactiveAgent + ReactiveAgents (public DX)
├── tests/
│   ├── execution-engine.test.ts
│   ├── builder.test.ts
│   └── runtime.test.ts
├── package.json
└── tsconfig.json
```

---

## Build Order

1. `src/types.ts` — ExecutionContext, LifecyclePhase, HookTiming, AgentState, ReactiveAgentsConfig
2. `src/errors.ts` — ExecutionError, HookError, RuntimeError
3. `src/hooks.ts` — LifecycleHookRegistry service (register, run hooks per phase/timing)
4. `src/execution-engine.ts` — ExecutionEngine Context.Tag + ExecutionEngineLive Layer
5. `src/runtime.ts` — ReactiveAgentsRuntime (composes ALL package layers into one Effect Layer)
6. `src/builder.ts` — ReactiveAgentBuilder + ReactiveAgent facade + ReactiveAgents namespace (see `FRAMEWORK_USAGE_GUIDE.md` §2 for full implementation spec)
7. `src/index.ts` — Public re-exports
8. Tests for ExecutionEngine and runtime composition

---

## Core Types & Schemas

### File: `src/types.ts`

```typescript
import { Schema } from "effect";

// ─── Lifecycle Phase ───

export const LifecyclePhase = Schema.Literal(
  "bootstrap", // Phase 1: Load memory context
  "guardrail", // Phase 2: Safety check (optional)
  "cost-route", // Phase 3: Model selection (optional)
  "strategy-select", // Phase 4: Reasoning strategy selection
  "think", // Phase 5a: LLM completion
  "act", // Phase 5b: Tool execution
  "observe", // Phase 5c: Observation appended
  "verify", // Phase 6: Result verification (optional)
  "memory-flush", // Phase 7: Memory extraction + snapshot
  "cost-track", // Phase 8: Cost recording (optional)
  "audit", // Phase 9: Audit logging (optional)
  "complete", // Phase 10: Task completion
);
export type LifecyclePhase = typeof LifecyclePhase.Type;

// ─── Hook Timing ───

export const HookTiming = Schema.Literal("before", "after", "on-error");
export type HookTiming = typeof HookTiming.Type;

// ─── Agent State Machine ───
//
// IDLE → BOOTSTRAPPING → RUNNING → VERIFYING → FLUSHING → COMPLETED
//                           ↕                               ↑
//                        PAUSED ──────────────────────────→
//                           ↕
//                         FAILED

export const AgentState = Schema.Literal(
  "idle",
  "bootstrapping",
  "running",
  "paused",
  "verifying",
  "flushing",
  "completed",
  "failed",
);
export type AgentState = typeof AgentState.Type;

// ─── Execution Context (passed between phases) ───

export const ExecutionContextSchema = Schema.Struct({
  taskId: Schema.String, // TaskId (String brand from core)
  agentId: Schema.String, // AgentId (String brand from core)
  sessionId: Schema.String, // Session ID (ULID)
  phase: LifecyclePhase,
  agentState: AgentState,
  iteration: Schema.Number, // Current loop iteration (0-indexed)
  maxIterations: Schema.Number, // Default: 10
  messages: Schema.Array(Schema.Unknown), // LLMMessage[] (from llm-provider)
  memoryContext: Schema.optional(Schema.Unknown), // MemoryBootstrapResult | undefined
  selectedStrategy: Schema.optional(Schema.String), // ReasoningStrategy | undefined
  selectedModel: Schema.optional(Schema.Unknown), // ModelConfig | undefined
  toolResults: Schema.Array(Schema.Unknown), // ToolResult[]
  cost: Schema.Number, // Running total cost in USD
  startedAt: Schema.DateFromSelf,
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type ExecutionContext = typeof ExecutionContextSchema.Type;

// ─── Tool Result ───

export const ToolResultSchema = Schema.Struct({
  toolCallId: Schema.String,
  toolName: Schema.String,
  result: Schema.Unknown,
  error: Schema.optional(Schema.String),
  durationMs: Schema.Number,
});
export type ToolResult = typeof ToolResultSchema.Type;

// ─── Lifecycle Hook ───

export interface LifecycleHook {
  readonly phase: LifecyclePhase;
  readonly timing: HookTiming;
  readonly handler: (
    ctx: ExecutionContext,
  ) => import("effect").Effect.Effect<
    ExecutionContext,
    import("./errors.js").ExecutionError
  >;
}

// ─── Reactive Agents Config ───

export const ReactiveAgentsConfigSchema = Schema.Struct({
  maxIterations: Schema.Number, // Default: 10
  defaultModel: Schema.optional(Schema.Unknown), // ModelConfig
  memoryTier: Schema.Literal("1", "2"), // Default: "1"
  enableGuardrails: Schema.Boolean, // Default: false (Phase 1)
  enableVerification: Schema.Boolean, // Default: false (Phase 1)
  enableCostTracking: Schema.Boolean, // Default: false (Phase 1)
  enableAudit: Schema.Boolean, // Default: false (Phase 1)
  agentId: Schema.String,
});
export type ReactiveAgentsConfig = typeof ReactiveAgentsConfigSchema.Type;

export const defaultReactiveAgentsConfig = (
  agentId: string,
): ReactiveAgentsConfig => ({
  maxIterations: 10,
  memoryTier: "1",
  enableGuardrails: false,
  enableVerification: false,
  enableCostTracking: false,
  enableAudit: false,
  agentId,
});
```

---

## Error Types

### File: `src/errors.ts`

```typescript
import { Data } from "effect";

export class ExecutionError extends Data.TaggedError("ExecutionError")<{
  readonly message: string;
  readonly taskId: string;
  readonly phase: string;
  readonly cause?: unknown;
}> {}

export class HookError extends Data.TaggedError("HookError")<{
  readonly message: string;
  readonly phase: string;
  readonly timing: string;
  readonly cause?: unknown;
}> {}

export class MaxIterationsError extends Data.TaggedError("MaxIterationsError")<{
  readonly message: string;
  readonly taskId: string;
  readonly iterations: number;
  readonly maxIterations: number;
}> {}

export class GuardrailViolationError extends Data.TaggedError(
  "GuardrailViolationError",
)<{
  readonly message: string;
  readonly taskId: string;
  readonly violation: string;
}> {}

export type RuntimeErrors =
  | ExecutionError
  | HookError
  | MaxIterationsError
  | GuardrailViolationError;
```

---

## Lifecycle Hook Registry

### File: `src/hooks.ts`

```typescript
import { Effect, Context, Layer, Ref } from "effect";
import type {
  LifecycleHook,
  LifecyclePhase,
  HookTiming,
  ExecutionContext,
} from "./types.js";
import { HookError } from "./errors.js";

// ─── Service Tag ───

export class LifecycleHookRegistry extends Context.Tag("LifecycleHookRegistry")<
  LifecycleHookRegistry,
  {
    /** Register a lifecycle hook. Returns unregister function. */
    readonly register: (
      hook: LifecycleHook,
    ) => Effect.Effect<() => void, never>;

    /** Run all hooks for a phase/timing. Returns updated context. */
    readonly run: (
      phase: LifecyclePhase,
      timing: HookTiming,
      ctx: ExecutionContext,
    ) => Effect.Effect<ExecutionContext, HookError>;

    /** Get all registered hooks. */
    readonly list: () => Effect.Effect<readonly LifecycleHook[], never>;
  }
>() {}

// ─── Live Implementation ───

export const LifecycleHookRegistryLive = Layer.effect(
  LifecycleHookRegistry,
  Effect.gen(function* () {
    const hooks = yield* Ref.make<LifecycleHook[]>([]);

    return {
      register: (hook) =>
        Effect.gen(function* () {
          yield* Ref.update(hooks, (hs) => [...hs, hook]);
          return () => {
            // Unregister: filter out this exact hook reference
            Effect.runSync(
              Ref.update(hooks, (hs) => hs.filter((h) => h !== hook)),
            );
          };
        }),

      run: (phase, timing, ctx) =>
        Effect.gen(function* () {
          const allHooks = yield* Ref.get(hooks);
          const matching = allHooks.filter(
            (h) => h.phase === phase && h.timing === timing,
          );

          let current = ctx;
          for (const hook of matching) {
            current = yield* hook.handler(current).pipe(
              Effect.mapError(
                (cause) =>
                  new HookError({
                    message: `Hook failed for ${phase}/${timing}: ${cause}`,
                    phase,
                    timing,
                    cause,
                  }),
              ),
            );
          }
          return current;
        }),

      list: () => Ref.get(hooks),
    };
  }),
);
```

---

## Execution Engine

### File: `src/execution-engine.ts`

```typescript
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
// These are resolved via Effect's Context.Tag at runtime
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";

// ─── Service Tag ───

export class ExecutionEngine extends Context.Tag("ExecutionEngine")<
  ExecutionEngine,
  {
    /**
     * Execute a task through the full agent loop (10 phases).
     * Returns TaskResult on success, fails with ExecutionError on failure.
     */
    readonly execute: (
      task: Task,
    ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;

    /**
     * Register a lifecycle hook to run at a specific phase and timing.
     */
    readonly registerHook: (hook: LifecycleHook) => Effect.Effect<void, never>;

    /**
     * Get the current execution context for a running task.
     * Returns null if task is not currently running.
     */
    readonly getContext: (
      taskId: string,
    ) => Effect.Effect<ExecutionContext | null, never>;

    /**
     * Cancel a running execution.
     */
    readonly cancel: (taskId: string) => Effect.Effect<void, ExecutionError>;
  }
>() {}

// ─── Live Implementation ───

export const ExecutionEngineLive = (config: ReactiveAgentsConfig) =>
  Layer.effect(
    ExecutionEngine,
    Effect.gen(function* () {
      const hookRegistry = yield* LifecycleHookRegistry;

      // Track running contexts (taskId → ExecutionContext)
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
        phase: typeof ctx.phase,
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
            ) as Effect.Effect<never, ExecutionError>;
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
        Effect.gen(function* () {
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

          try {
            // ── Phase 1: BOOTSTRAP ──
            ctx = yield* runPhase(ctx, "bootstrap", (c) =>
              Effect.gen(function* () {
                // MemoryService is optional — skip if not provided
                const memoryContext = yield* Effect.serviceOption(
                  // Dynamic service lookup — avoids hard circular dep
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
                Effect.gen(function* () {
                  // GuardrailService check — implementation in @reactive-agents/guardrails
                  // If guardrails not provided, this is a no-op
                  return c;
                }),
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
                // Optionally delegate to StrategySelector (from @reactive-agents/reasoning)
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
                    : "reactive"; // default fallback when reasoning package not available
                return { ...c, selectedStrategy: strategy };
              }),
            );

            // ── Phase 5: AGENT_LOOP ──
            // If @reactive-agents/reasoning is available, delegate to ReasoningService.
            // Otherwise, use the minimal direct-LLM loop below (Phase 1 bootstrap path).
            const reasoningOpt = yield* Effect.serviceOption(
              Context.GenericTag<{
                execute: (
                  strategy: string,
                  input: unknown,
                ) => Effect.Effect<{
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
                  const result = yield* reasoningOpt.value.execute(
                    c.selectedStrategy ?? "reactive",
                    {
                      taskDescription: JSON.stringify(task.input),
                      taskType: task.type,
                      memoryContext: String(
                        (c.memoryContext as any)?.semanticContext ?? "",
                      ),
                      availableTools: [],
                      config: undefined, // uses default reasoning config
                    },
                  );
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
              // ── Minimal direct-LLM loop (Phase 1 bootstrap, no reasoning package) ──
              let isComplete = false;

              while (!isComplete && ctx.iteration < ctx.maxIterations) {
                // 5a. THINK
                ctx = yield* runPhase(ctx, "think", (c) =>
                  Effect.gen(function* () {
                    // LLMService.complete — required
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

                    // Detect completion heuristic (override with hooks for production)
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
                  }),
                );

                // 5b. ACT (if tool calls present)
                const pendingCalls =
                  (ctx.metadata.pendingToolCalls as unknown[]) ?? [];
                if (pendingCalls.length > 0) {
                  ctx = yield* runPhase(ctx, "act", (c) =>
                    Effect.gen(function* () {
                      // ToolService.execute — optional
                      // In Phase 1, tool execution results are mocked
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

                  // 5c. OBSERVE — append tool results to messages
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
                  // 5d. LOOP_CHECK — no tool calls, advance iteration
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
            } // end else (minimal direct-LLM loop)

            // ── Phase 6: VERIFY (optional) ──
            if (config.enableVerification) {
              ctx = yield* runPhase(ctx, "verify", (c) => Effect.succeed(c));
            }

            // ── Phase 7: MEMORY_FLUSH ──
            ctx = yield* runPhase(ctx, "memory-flush", (c) =>
              Effect.gen(function* () {
                // MemoryService.snapshot — optional
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
          } finally {
            // Always clean up running context
            yield* Ref.update(runningContexts, (m) => {
              const next = new Map(m);
              next.delete(task.id);
              return next;
            });
          }
        });

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
```

---

## Agent State Machine

```
                    ┌─────────────────────────────────────┐
                    │            State Machine             │
                    └─────────────────────────────────────┘

    Task.create()
         │
         ▼
      ┌──────┐
      │ IDLE │
      └──────┘
         │  ExecutionEngine.execute(task)
         ▼
  ┌──────────────┐
  │ BOOTSTRAPPING │  ← Phase 1: MemoryService.bootstrap()
  └──────────────┘
         │
         ▼
    ┌─────────┐
    │ RUNNING │  ←──────────────────────┐
    └─────────┘                          │
         │  ToolCall present             │
         ▼                               │
    ┌─────────┐                          │
    │ PAUSED  │ ── resume ───────────────┘
    └─────────┘
         │  Error
         ▼
    ┌────────┐
    │ FAILED │
    └────────┘

    (on success after loop exits)
         │
         ▼
  ┌────────────┐
  │ VERIFYING  │  ← Phase 6: VerificationService.verify()
  └────────────┘
         │
         ▼
  ┌──────────┐
  │ FLUSHING │  ← Phase 7: MemoryService.snapshot()
  └──────────┘
         │
         ▼
  ┌───────────┐
  │ COMPLETED │
  └───────────┘
```

---

## New SystemEvent Union Entries

Add these to `@reactive-agents/core`'s `AgentEvent` union in `src/services/event-bus.ts`:

```typescript
// Add to AgentEvent union:
| { readonly _tag: "ExecutionPhaseEntered"; readonly taskId: string; readonly phase: string }
| { readonly _tag: "ExecutionHookFired"; readonly taskId: string; readonly phase: string; readonly timing: string }
| { readonly _tag: "ExecutionLoopIteration"; readonly taskId: string; readonly iteration: number }
| { readonly _tag: "ExecutionCancelled"; readonly taskId: string }
| { readonly _tag: "MemoryBootstrapped"; readonly agentId: string; readonly tier: string }
| { readonly _tag: "MemoryFlushed"; readonly agentId: string }
| { readonly _tag: "MemorySnapshotSaved"; readonly agentId: string; readonly sessionId: string }
```

---

## Runtime Factory

### File: `src/runtime.ts`

```typescript
import { Layer } from "effect";
import { LifecycleHookRegistryLive } from "./hooks.js";
import { ExecutionEngineLive } from "./execution-engine.js";
import type { ReactiveAgentsConfig } from "./types.js";
import { defaultReactiveAgentsConfig } from "./types.js";

// Import Live layers from other packages
// These are optional — omit them for minimal runtimes
import { CoreServicesLive } from "@reactive-agents/core";
import { createLLMLayer } from "@reactive-agents/llm-provider";
import { createMemoryLayer } from "@reactive-agents/memory";

/**
 * Create a minimal runtime (Core + LLM + Memory + ExecutionEngine).
 *
 * For production use, add optional layers:
 *   - createGuardrailsLayer() from @reactive-agents/guardrails
 *   - createVerificationLayer() from @reactive-agents/verification
 *   - createCostLayer() from @reactive-agents/cost
 *
 * Usage:
 *   const Runtime = createRuntime({
 *     agentId: "my-agent",
 *     anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
 *   });
 *
 *   await Effect.runPromise(
 *     ExecutionEngine.pipe(
 *       Effect.flatMap((engine) => engine.execute(task)),
 *       Effect.provide(Runtime),
 *     )
 *   );
 */
export const createRuntime = (options: {
  agentId: string;
  /** LLM provider to use. Default: "anthropic" */
  provider?: "anthropic" | "openai" | "ollama";
  /** API key for the selected provider (Anthropic or OpenAI). */
  apiKey?: string;
  /** Base URL override (required for Ollama, optional for OpenAI-compatible endpoints). */
  baseUrl?: string;
  /** @deprecated Use `apiKey` instead. Kept for backward compatibility. */
  anthropicApiKey?: string;
  /** @deprecated Use `provider: "openai"` + `apiKey` instead. */
  openaiApiKey?: string;
  memoryTier?: "1" | "2";
  maxIterations?: number;
  /** Enable guardrail safety checks (Phase 2). Requires @reactive-agents/guardrails. Default: false */
  enableGuardrails?: boolean;
  /** Enable result verification (Phase 6). Requires @reactive-agents/verification. Default: false */
  enableVerification?: boolean;
  /** Enable cost tracking and model routing (Phases 3 + 8). Requires @reactive-agents/cost. Default: false */
  enableCostTracking?: boolean;
  /** Enable audit logging (Phase 9). Requires @reactive-agents/identity. Default: false */
  enableAudit?: boolean;
  extraLayers?: Layer.Layer<unknown, unknown>;
}) => {
  // Resolve provider credentials (backward-compat: anthropicApiKey / openaiApiKey)
  const resolvedProvider =
    options.provider ?? (options.openaiApiKey ? "openai" : "anthropic");
  const resolvedApiKey =
    options.apiKey ?? options.anthropicApiKey ?? options.openaiApiKey ?? "";

  const config: ReactiveAgentsConfig = {
    ...defaultReactiveAgentsConfig(options.agentId),
    memoryTier: options.memoryTier ?? "1",
    maxIterations: options.maxIterations ?? 10,
    enableGuardrails: options.enableGuardrails ?? false,
    enableVerification: options.enableVerification ?? false,
    enableCostTracking: options.enableCostTracking ?? false,
    enableAudit: options.enableAudit ?? false,
  };

  const coreLayer = CoreServicesLive;

  const llmLayer = createLLMLayer({
    provider: resolvedProvider,
    ...(resolvedProvider === "anthropic"
      ? { anthropicApiKey: resolvedApiKey }
      : {}),
    ...(resolvedProvider === "openai" ? { openaiApiKey: resolvedApiKey } : {}),
    ...(resolvedProvider === "ollama"
      ? { baseUrl: options.baseUrl ?? "http://localhost:11434" }
      : {}),
  });

  const memoryLayer = createMemoryLayer(config.memoryTier, {
    agentId: options.agentId,
  });

  const hookLayer = LifecycleHookRegistryLive;

  const engineLayer = ExecutionEngineLive(config).pipe(
    Layer.provide(hookLayer),
  );

  const baseRuntime = Layer.mergeAll(
    coreLayer,
    llmLayer,
    memoryLayer,
    hookLayer,
    engineLayer,
  );

  if (options.extraLayers) {
    return Layer.merge(
      baseRuntime,
      options.extraLayers as Layer.Layer<unknown>,
    );
  }

  return baseRuntime;
};
```

---

## Public API

### File: `src/index.ts`

```typescript
// ─── Types ───
export type {
  LifecyclePhase,
  HookTiming,
  AgentState,
  ExecutionContext,
  ToolResult,
  LifecycleHook,
  ReactiveAgentsConfig,
} from "./types.js";

// ─── Schemas ───
export {
  ExecutionContextSchema,
  ToolResultSchema,
  ReactiveAgentsConfigSchema,
  defaultReactiveAgentsConfig,
} from "./types.js";

// ─── Errors ───
export {
  ExecutionError,
  HookError,
  MaxIterationsError,
  GuardrailViolationError,
  type RuntimeErrors,
} from "./errors.js";

// ─── Services ───
export { LifecycleHookRegistry, LifecycleHookRegistryLive } from "./hooks.js";

export { ExecutionEngine, ExecutionEngineLive } from "./execution-engine.js";

// ─── Runtime ───
export { createRuntime } from "./runtime.js";

// ─── Builder (Primary Public DX) ───
// Full implementation spec in FRAMEWORK_USAGE_GUIDE.md §2
export {
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,
} from "./builder.js";
export type { AgentResult, AgentResultMetadata } from "./builder.js";
```

---

## Configuration

### File: `package.json`

```json
{
  "name": "@reactive-agents/runtime",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "dependencies": {
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "@reactive-agents/memory": "workspace:*",
    "effect": "^3.10.0"
  },
  "optionalDependencies": {
    "@reactive-agents/guardrails": "workspace:*",
    "@reactive-agents/verification": "workspace:*",
    "@reactive-agents/cost": "workspace:*",
    "@reactive-agents/observability": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "bun-types": "latest"
  }
}
```

---

## Testing

### File: `tests/execution-engine.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Context } from "effect";
import {
  ExecutionEngine,
  ExecutionEngineLive,
  LifecycleHookRegistryLive,
} from "../src/index.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";

// Minimal mock LLM service
const MockLLMServiceLive = Layer.succeed(Context.GenericTag("LLMService"), {
  complete: (_req: unknown) =>
    Effect.succeed({
      content: "Task completed: Here is the answer.",
      stopReason: "end_turn",
      toolCalls: [],
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        estimatedCost: 0,
      },
      model: "claude-haiku",
    }),
});

// Minimal mock task
const mockTask = {
  id: "task-001" as any,
  agentId: "agent-001" as any,
  type: "query" as const,
  input: { question: "What is 2+2?" },
  priority: "medium" as const,
  status: "pending" as const,
  metadata: { tags: [] },
  createdAt: new Date(),
};

describe("ExecutionEngine", () => {
  const config = defaultReactiveAgentsConfig("agent-001");

  const testLayer = Layer.mergeAll(
    LifecycleHookRegistryLive,
    ExecutionEngineLive(config),
    MockLLMServiceLive,
  );

  it("should execute a task through all phases", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.taskId).toBe("task-001");
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
  });

  it("should track running context during execution", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;

        // Register a hook to inspect context mid-execution
        yield* engine.registerHook({
          phase: "think",
          timing: "before",
          handler: (ctx) =>
            Effect.gen(function* () {
              const running = yield* engine.getContext(ctx.taskId);
              expect(running).not.toBeNull();
              return ctx;
            }),
        });

        yield* engine.execute(mockTask);
      }).pipe(Effect.provide(testLayer)),
    );
  });

  it("should fail with MaxIterationsError when loop exceeds limit", async () => {
    // Mock LLM that always returns tool calls (never completes)
    const LoopingLLM = Layer.succeed(Context.GenericTag("LLMService"), {
      complete: (_req: unknown) =>
        Effect.succeed({
          content: "Calling tool...",
          stopReason: "tool_use",
          toolCalls: [{ id: "call-1", name: "search", input: {} }],
          usage: {
            inputTokens: 5,
            outputTokens: 5,
            totalTokens: 10,
            estimatedCost: 0,
          },
          model: "claude-haiku",
        }),
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const engine = yield* ExecutionEngine;
        return yield* engine.execute(mockTask).pipe(Effect.either);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            LifecycleHookRegistryLive,
            ExecutionEngineLive({ ...config, maxIterations: 2 }),
            LoopingLLM,
          ),
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("MaxIterationsError");
    }
  });
});
```

---

## Performance Targets

| Operation                      | Target  | Notes                                |
| ------------------------------ | ------- | ------------------------------------ |
| ExecutionEngine.execute() init | < 5ms   | Context setup + hook registry lookup |
| Phase transition               | < 1ms   | Hook dispatch overhead               |
| Bootstrap phase (with memory)  | < 10ms  | Memory.bootstrap() + context build   |
| Agent loop iteration           | Depends | LLM latency dominates (200ms-2s)     |
| Memory flush phase             | < 10ms  | Snapshot write to SQLite             |
| Hook registration              | < 1ms   | Ref.update                           |
| Context cleanup (finally)      | < 1ms   | Map.delete                           |

---

## Success Criteria

- [ ] All types defined with Schema (not plain interfaces)
- [ ] All errors use Data.TaggedError
- [ ] ExecutionEngine uses Context.Tag + Layer.effect
- [ ] 10-phase agent loop executes in correct order
- [ ] LifecycleHooks fire before/after/on-error for each phase
- [ ] Optional phases (guardrail, verify, cost-track, audit) can be skipped
- [ ] Running contexts tracked (getContext returns non-null during execution)
- [ ] cancel() interrupts a running execution
- [ ] MaxIterationsError thrown when loop exceeds maxIterations
- [ ] createRuntime() composes Core + LLM + Memory + Engine layers
- [ ] ReactiveAgents.create().withModel(...).build() resolves to ReactiveAgent
- [ ] ReactiveAgent.run(input) returns AgentResult with output, success, metadata
- [ ] ReactiveAgentBuilder.buildEffect() returns Effect<ReactiveAgent>
- [ ] All tests pass with bun test

---

## Dependencies

**Requires:**

- `@reactive-agents/core`: Task, TaskResult, AgentId, TaskId, EventBus
- `@reactive-agents/llm-provider`: LLMService (required for agent loop THINK phase)
- `@reactive-agents/memory`: MemoryService (required for BOOTSTRAP + MEMORY_FLUSH phases)

**Optionally uses:**

- `@reactive-agents/guardrails`: GuardrailService (Phase 2)
- `@reactive-agents/verification`: VerificationService (Phase 6)
- `@reactive-agents/cost`: CostRouter, CostTracker (Phases 3 + 8)
- `@reactive-agents/identity`: AuditService (Phase 9)
- `@reactive-agents/tools`: ToolService (Phase 5b ACT)
- `@reactive-agents/reasoning`: StrategySelector (Phase 4)

**Provides to:**

- End users — the primary entry point for running the framework
- Integration tests — `createRuntime()` is the test harness

**Status: Ready for AI agent implementation**
**Priority: Phase 1C (concurrent with Memory, Week 2-3)**
