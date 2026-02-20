# Layer 1: Core Foundation - AI Agent Implementation Spec

## Overview

Core runtime providing types, services, error handling, event bus, and dependency injection for all layers. Built on Effect-TS with Schema-validated types and tagged errors.

**Package:** `@reactive-agents/core`
**Dependencies:** `effect@^3.10`, `ulid`
**Phase:** 1A (Weeks 1-2)

---

## Package Structure

```
@reactive-agents/core/
├── src/
│   ├── index.ts                    # Public API re-exports
│   ├── types/
│   │   ├── agent.ts                # Agent schema & types
│   │   ├── task.ts                 # Task schema & types
│   │   ├── result.ts               # TaskResult schema & types
│   │   ├── message.ts              # Message schema & types
│   │   └── config.ts               # RuntimeConfig schema
│   ├── errors/
│   │   └── errors.ts               # All Data.TaggedError definitions
│   ├── services/
│   │   ├── agent-service.ts        # AgentService Context.Tag + Live Layer
│   │   ├── task-service.ts         # TaskService Context.Tag + Live Layer
│   │   ├── event-bus.ts            # EventBus Context.Tag + Live Layer
│   │   └── context-window-manager.ts  # ContextWindowManager Context.Tag + Live Layer
│   ├── id.ts                       # ULID-based ID generation (Brand types)
│   └── runtime.ts                  # CoreServicesLive (merged layer)
├── tests/
│   ├── agent-service.test.ts
│   ├── task-service.test.ts
│   ├── event-bus.test.ts
│   ├── context-window-manager.test.ts
│   └── types.test.ts
├── package.json
└── tsconfig.json
```

---

## Build Order

1. `src/types/agent.ts` — Agent, Capability schemas
2. `src/types/task.ts` — Task, TaskStatus schemas
3. `src/types/result.ts` — TaskResult schema
4. `src/types/message.ts` — Message schema
5. `src/types/config.ts` — RuntimeConfig schema
6. `src/errors/errors.ts` — All error types
7. `src/id.ts` — ID generation with Brand types
8. `src/services/event-bus.ts` — EventBus service + layer
9. `src/services/agent-service.ts` — AgentService + layer
10. `src/services/task-service.ts` — TaskService + layer
11. `src/services/context-window-manager.ts` — ContextWindowManager service + layer
12. `src/runtime.ts` — CoreServicesLive merged layer (includes ContextWindowManager)
13. `src/index.ts` — Public re-exports
14. Tests for each service

---

## Core Types & Schemas

### File: `src/types/agent.ts`

```typescript
import { Schema } from "effect";

// ─── Agent ID (branded string) ───

export const AgentId = Schema.String.pipe(Schema.brand("AgentId"));
export type AgentId = typeof AgentId.Type;

// ─── Capability ───

export const CapabilityType = Schema.Literal(
  "tool",
  "skill",
  "reasoning",
  "memory",
);
export type CapabilityType = typeof CapabilityType.Type;

export const CapabilitySchema = Schema.Struct({
  type: CapabilityType,
  name: Schema.String,
});
export type Capability = typeof CapabilitySchema.Type;

// ─── Reasoning Strategy (shared across layers) ───

export const ReasoningStrategy = Schema.Literal(
  "reactive",
  "plan-execute-reflect",
  "tree-of-thought",
  "reflexion",
  "adaptive",
);
export type ReasoningStrategy = typeof ReasoningStrategy.Type;

// ─── Memory Type ───
// Updated: "factual" replaced by "semantic" + "procedural" (see 02-layer-memory.md)

export const MemoryType = Schema.Literal(
  "semantic", // Long-term knowledge (SQLite + memory.md)
  "episodic", // Daily logs + session snapshots
  "procedural", // Learned workflows and patterns
  "working", // In-process Ref, capacity 7
);
export type MemoryType = typeof MemoryType.Type;

// ─── Agent Schema ───

export const AgentSchema = Schema.Struct({
  id: AgentId,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  capabilities: Schema.Array(CapabilitySchema),
  config: Schema.Unknown,
  state: Schema.Unknown,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type Agent = typeof AgentSchema.Type;

// ─── Agent Config (input for creating agents) ───

export const AgentConfigSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  capabilities: Schema.Array(CapabilitySchema),
  config: Schema.optional(Schema.Unknown),
  initialState: Schema.optional(Schema.Unknown),
});
export type AgentConfig = typeof AgentConfigSchema.Type;
```

### File: `src/types/task.ts`

```typescript
import { Schema } from "effect";
import { AgentId } from "./agent.js";

// ─── Task ID (branded string) ───

export const TaskId = Schema.String.pipe(Schema.brand("TaskId"));
export type TaskId = typeof TaskId.Type;

// ─── Task Type ───

export const TaskType = Schema.Literal(
  "query",
  "action",
  "workflow",
  "research",
  "delegation",
);
export type TaskType = typeof TaskType.Type;

// ─── Priority ───

export const Priority = Schema.Literal("low", "medium", "high", "critical");
export type Priority = typeof Priority.Type;

// ─── Task Status ───

export const TaskStatus = Schema.Literal(
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
);
export type TaskStatus = typeof TaskStatus.Type;

// ─── Task Metadata ───

export const TaskMetadataSchema = Schema.Struct({
  maxDuration: Schema.optional(Schema.Number),
  maxCost: Schema.optional(Schema.Number),
  requiresApproval: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(Schema.String)),
  context: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
});
export type TaskMetadata = typeof TaskMetadataSchema.Type;

// ─── Task Schema ───

export const TaskSchema = Schema.Struct({
  id: TaskId,
  agentId: AgentId,
  type: TaskType,
  input: Schema.Unknown,
  priority: Priority,
  status: TaskStatus,
  metadata: TaskMetadataSchema,
  createdAt: Schema.DateFromSelf,
  startedAt: Schema.optional(Schema.DateFromSelf),
  completedAt: Schema.optional(Schema.DateFromSelf),
});
export type Task = typeof TaskSchema.Type;

// ─── Task Config (input for creating tasks) ───

export const TaskConfigSchema = Schema.Struct({
  agentId: AgentId,
  type: TaskType,
  input: Schema.Unknown,
  priority: Schema.optional(Priority),
  metadata: Schema.optional(TaskMetadataSchema),
});
export type TaskConfig = typeof TaskConfigSchema.Type;
```

### File: `src/types/result.ts`

```typescript
import { Schema } from "effect";
import { AgentId } from "./agent.js";
import { TaskId } from "./task.js";

// ─── Reasoning Step ───

export const StepType = Schema.Literal(
  "thought",
  "action",
  "observation",
  "plan",
  "reflection",
  "critique",
);
export type StepType = typeof StepType.Type;

export const ReasoningStepSchema = Schema.Struct({
  id: Schema.String,
  type: StepType,
  content: Schema.String,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Struct({
      confidence: Schema.optional(Schema.Number),
      toolUsed: Schema.optional(Schema.String),
      cost: Schema.optional(Schema.Number),
      duration: Schema.optional(Schema.Number),
    }),
  ),
});
export type ReasoningStep = typeof ReasoningStepSchema.Type;

// ─── Result Metadata ───

export const ResultMetadataSchema = Schema.Struct({
  duration: Schema.Number,
  cost: Schema.Number,
  tokensUsed: Schema.Number,
  confidence: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
  strategyUsed: Schema.optional(Schema.String),
  stepsCount: Schema.optional(Schema.Number),
});
export type ResultMetadata = typeof ResultMetadataSchema.Type;

// ─── Task Result ───

export const TaskResultSchema = Schema.Struct({
  taskId: TaskId,
  agentId: AgentId,
  output: Schema.Unknown,
  success: Schema.Boolean,
  error: Schema.optional(Schema.String),
  metadata: ResultMetadataSchema,
  completedAt: Schema.DateFromSelf,
});
export type TaskResult = typeof TaskResultSchema.Type;
```

### File: `src/types/message.ts`

```typescript
import { Schema } from "effect";
import { AgentId } from "./agent.js";

// ─── Message ID (branded string) ───

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

// ─── Message Type ───

export const MessageType = Schema.Literal(
  "request",
  "response",
  "notification",
  "delegation",
  "query",
);
export type MessageType = typeof MessageType.Type;

// ─── Message Schema ───

export const MessageSchema = Schema.Struct({
  id: MessageId,
  fromAgentId: AgentId,
  toAgentId: AgentId,
  type: MessageType,
  content: Schema.Unknown,
  timestamp: Schema.DateFromSelf,
  metadata: Schema.optional(
    Schema.Struct({
      correlationId: Schema.optional(Schema.String),
      causationId: Schema.optional(Schema.String),
      context: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    }),
  ),
});
export type Message = typeof MessageSchema.Type;
```

### File: `src/types/config.ts`

```typescript
import { Schema } from "effect";

// ─── Log Level ───

export const LogLevel = Schema.Literal("debug", "info", "warn", "error");
export type LogLevel = typeof LogLevel.Type;

// ─── Telemetry Config ───

export const TelemetryConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  endpoint: Schema.optional(Schema.String),
  serviceName: Schema.String,
  sampleRate: Schema.Number.pipe(Schema.between(0, 1)),
});
export type TelemetryConfig = typeof TelemetryConfigSchema.Type;

// ─── Runtime Config ───

export const RuntimeConfigSchema = Schema.Struct({
  maxConcurrentTasks: Schema.Number,
  taskTimeout: Schema.Number,
  maxRetries: Schema.Number,
  retryDelay: Schema.Number,
  logLevel: LogLevel,
  telemetry: TelemetryConfigSchema,
});
export type RuntimeConfig = typeof RuntimeConfigSchema.Type;

// ─── Default Config ───

export const defaultRuntimeConfig: RuntimeConfig = {
  maxConcurrentTasks: 10,
  taskTimeout: 300_000,
  maxRetries: 3,
  retryDelay: 1_000,
  logLevel: "info",
  telemetry: {
    enabled: true,
    serviceName: "reactive-agents",
    sampleRate: 1.0,
  },
};

// ─── Context Controller (Vision Pillar: Control) ───

export const ContextControllerSchema = Schema.Struct({
  prioritization: Schema.optional(
    Schema.Literal("semantic", "recency", "importance"),
  ),
  pruning: Schema.optional(
    Schema.Literal("adaptive", "sliding-window", "fifo"),
  ),
  retention: Schema.optional(Schema.Array(Schema.String)),
  compression: Schema.optional(
    Schema.Literal("none", "aggressive", "adaptive"),
  ),
});
export type ContextController = typeof ContextControllerSchema.Type;

// ─── Circuit Breaker (Vision Pillar: Reliability) ───

export const CircuitBreakerConfigSchema = Schema.Struct({
  errorThreshold: Schema.Number.pipe(Schema.between(0, 1)),
  timeout: Schema.Number, // ms: max execution time before trip
  resetTimeout: Schema.Number, // ms: time before attempting reset
});
export type CircuitBreakerConfig = typeof CircuitBreakerConfigSchema.Type;

// ─── Token Budget (Vision Pillar: Efficiency) ───

export const TokenBudgetConfigSchema = Schema.Struct({
  total: Schema.Number,
  allocation: Schema.optional(
    Schema.Struct({
      system: Schema.optional(Schema.Number),
      context: Schema.optional(Schema.Number),
      reasoning: Schema.optional(Schema.Number),
      output: Schema.optional(Schema.Number),
    }),
  ),
  enforcement: Schema.Literal("hard", "soft"),
});
export type TokenBudgetConfig = typeof TokenBudgetConfigSchema.Type;

// ─── Decision & Uncertainty Signals (Vision Pillar: Control) ───

export const UncertaintySignalSchema = Schema.Struct({
  taskId: Schema.String,
  agentId: Schema.String,
  confidence: Schema.Number,
  phase: Schema.String,
  context: Schema.String,
});
export type UncertaintySignal = typeof UncertaintySignalSchema.Type;

export const AgentDecisionSchema = Schema.Struct({
  type: Schema.Literal("tool_call", "strategy_switch", "output"),
  importance: Schema.Number,
  content: Schema.Unknown,
});
export type AgentDecision = typeof AgentDecisionSchema.Type;
```

---

## Error Types

### File: `src/errors/errors.ts`

```typescript
import { Data } from "effect";

/**
 * Base agent error — catch-all for unexpected agent failures.
 */
export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Agent not found in registry.
 */
export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  readonly agentId: string;
  readonly message: string;
}> {}

/**
 * Task execution failure.
 */
export class TaskError extends Data.TaggedError("TaskError")<{
  readonly taskId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Schema validation failure.
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly message: string;
  readonly value?: unknown;
}> {}

/**
 * Runtime failure (fiber crash, timeout, etc.).
 */
export class RuntimeError extends Data.TaggedError("RuntimeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
```

---

## ID Generation

### File: `src/id.ts`

```typescript
import { ulid } from "ulid";
import type { AgentId } from "./types/agent.js";
import type { TaskId } from "./types/task.js";
import type { MessageId } from "./types/message.js";

/** Generate a new AgentId (ULID — sortable, globally unique). */
export const generateAgentId = (): AgentId => ulid() as AgentId;

/** Generate a new TaskId. */
export const generateTaskId = (): TaskId => ulid() as TaskId;

/** Generate a new MessageId. */
export const generateMessageId = (): MessageId => ulid() as MessageId;
```

---

## Effect Services

### File: `src/services/event-bus.ts`

```typescript
import { Effect, Context, Layer, Ref } from "effect";
import type { Message } from "../types/message.js";

// ─── Event Types ───

export type AgentEvent =
  // ─── Core task/agent events ───
  | { readonly _tag: "TaskCreated"; readonly taskId: string }
  | {
      readonly _tag: "TaskCompleted";
      readonly taskId: string;
      readonly success: boolean;
    }
  | {
      readonly _tag: "TaskFailed";
      readonly taskId: string;
      readonly error: string;
    }
  | { readonly _tag: "AgentCreated"; readonly agentId: string }
  | { readonly _tag: "MessageSent"; readonly message: Message }
  // ─── Execution Engine events (from @reactive-agents/runtime) ───
  | {
      readonly _tag: "ExecutionPhaseEntered";
      readonly taskId: string;
      readonly phase: string;
    }
  | {
      readonly _tag: "ExecutionHookFired";
      readonly taskId: string;
      readonly phase: string;
      readonly timing: string;
    }
  | {
      readonly _tag: "ExecutionLoopIteration";
      readonly taskId: string;
      readonly iteration: number;
    }
  | { readonly _tag: "ExecutionCancelled"; readonly taskId: string }
  // ─── Memory events (from @reactive-agents/memory) ───
  | {
      readonly _tag: "MemoryBootstrapped";
      readonly agentId: string;
      readonly tier: string;
    }
  | { readonly _tag: "MemoryFlushed"; readonly agentId: string }
  | {
      readonly _tag: "MemorySnapshotSaved";
      readonly agentId: string;
      readonly sessionId: string;
    }
  // ─── Custom/extension events ───
  | {
      readonly _tag: "Custom";
      readonly type: string;
      readonly payload: unknown;
    };

export type EventHandler = (event: AgentEvent) => Effect.Effect<void, never>;

// ─── Service Tag ───

export class EventBus extends Context.Tag("EventBus")<
  EventBus,
  {
    /** Publish an event to all subscribers. */
    readonly publish: (event: AgentEvent) => Effect.Effect<void, never>;

    /** Subscribe a handler for all events. Returns unsubscribe function. */
    readonly subscribe: (
      handler: EventHandler,
    ) => Effect.Effect<() => void, never>;

    /** Subscribe only to events matching a tag. */
    readonly on: (
      tag: AgentEvent["_tag"],
      handler: EventHandler,
    ) => Effect.Effect<() => void, never>;
  }
>() {}

// ─── Live Implementation ───

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const handlers = yield* Ref.make<EventHandler[]>([]);

    return {
      publish: (event) =>
        Effect.gen(function* () {
          const hs = yield* Ref.get(handlers);
          yield* Effect.all(
            hs.map((h) => h(event)),
            { concurrency: "unbounded" },
          );
        }),

      subscribe: (handler) =>
        Effect.gen(function* () {
          yield* Ref.update(handlers, (hs) => [...hs, handler]);
          return () => {
            Effect.runSync(
              Ref.update(handlers, (hs) => hs.filter((h) => h !== handler)),
            );
          };
        }),

      on: (tag, handler) =>
        Effect.gen(function* () {
          const filtered: EventHandler = (event) =>
            event._tag === tag ? handler(event) : Effect.void;
          yield* Ref.update(handlers, (hs) => [...hs, filtered]);
          return () => {
            Effect.runSync(
              Ref.update(handlers, (hs) => hs.filter((h) => h !== filtered)),
            );
          };
        }),
    };
  }),
);
```

### File: `src/services/agent-service.ts`

```typescript
import { Effect, Context, Layer, Ref } from "effect";
import type { Agent, AgentConfig, AgentId } from "../types/agent.js";
import { generateAgentId } from "../id.js";
import { AgentError, AgentNotFoundError } from "../errors/errors.js";
import { EventBus } from "./event-bus.js";

// ─── Service Tag ───

export class AgentService extends Context.Tag("AgentService")<
  AgentService,
  {
    /** Create a new agent from config. */
    readonly create: (config: AgentConfig) => Effect.Effect<Agent, AgentError>;

    /** Retrieve an agent by ID. */
    readonly get: (id: AgentId) => Effect.Effect<Agent, AgentNotFoundError>;

    /** List all registered agents. */
    readonly list: () => Effect.Effect<readonly Agent[], never>;

    /** Delete an agent by ID. */
    readonly delete: (id: AgentId) => Effect.Effect<void, AgentNotFoundError>;
  }
>() {}

// ─── Live Implementation ───

export const AgentServiceLive = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const store = yield* Ref.make<Map<string, Agent>>(new Map());

    return {
      create: (config) =>
        Effect.gen(function* () {
          const now = new Date();
          const agent: Agent = {
            id: generateAgentId(),
            name: config.name,
            description: config.description,
            capabilities: config.capabilities ?? [],
            config: config.config ?? {},
            state: config.initialState ?? {},
            createdAt: now,
            updatedAt: now,
          };
          yield* Ref.update(store, (m) => new Map(m).set(agent.id, agent));
          yield* eventBus.publish({ _tag: "AgentCreated", agentId: agent.id });
          return agent;
        }),

      get: (id) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          const agent = m.get(id);
          if (!agent) {
            return yield* Effect.fail(
              new AgentNotFoundError({
                agentId: id,
                message: `Agent ${id} not found`,
              }),
            );
          }
          return agent;
        }),

      list: () =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          return Array.from(m.values());
        }),

      delete: (id) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          if (!m.has(id)) {
            return yield* Effect.fail(
              new AgentNotFoundError({
                agentId: id,
                message: `Agent ${id} not found`,
              }),
            );
          }
          yield* Ref.update(store, (m) => {
            const next = new Map(m);
            next.delete(id);
            return next;
          });
        }),
    };
  }),
);
```

### File: `src/services/task-service.ts`

```typescript
import { Effect, Context, Layer, Ref } from "effect";
import type { Task, TaskConfig, TaskId } from "../types/task.js";
import { generateTaskId } from "../id.js";
import { TaskError } from "../errors/errors.js";
import { EventBus } from "./event-bus.js";

// ─── Service Tag ───

export class TaskService extends Context.Tag("TaskService")<
  TaskService,
  {
    /** Create a new task (status: pending). */
    readonly create: (config: TaskConfig) => Effect.Effect<Task, TaskError>;

    /** Get task by ID. */
    readonly get: (id: TaskId) => Effect.Effect<Task, TaskError>;

    /** Update task status. */
    readonly updateStatus: (
      id: TaskId,
      status: Task["status"],
    ) => Effect.Effect<Task, TaskError>;

    /** Cancel a running task. */
    readonly cancel: (id: TaskId) => Effect.Effect<void, TaskError>;
  }
>() {}

// ─── Live Implementation ───

export const TaskServiceLive = Layer.effect(
  TaskService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const store = yield* Ref.make<Map<string, Task>>(new Map());

    return {
      create: (config) =>
        Effect.gen(function* () {
          const task: Task = {
            id: generateTaskId(),
            agentId: config.agentId,
            type: config.type,
            input: config.input,
            priority: config.priority ?? "medium",
            status: "pending",
            metadata: config.metadata ?? {},
            createdAt: new Date(),
          };
          yield* Ref.update(store, (m) => new Map(m).set(task.id, task));
          yield* eventBus.publish({ _tag: "TaskCreated", taskId: task.id });
          return task;
        }),

      get: (id) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          const task = m.get(id);
          if (!task) {
            return yield* Effect.fail(
              new TaskError({ taskId: id, message: `Task ${id} not found` }),
            );
          }
          return task;
        }),

      updateStatus: (id, status) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          const task = m.get(id);
          if (!task) {
            return yield* Effect.fail(
              new TaskError({ taskId: id, message: `Task ${id} not found` }),
            );
          }
          const updated: Task = { ...task, status };
          yield* Ref.update(store, (m) => new Map(m).set(id, updated));
          if (status === "completed") {
            yield* eventBus.publish({
              _tag: "TaskCompleted",
              taskId: id,
              success: true,
            });
          } else if (status === "failed") {
            yield* eventBus.publish({
              _tag: "TaskFailed",
              taskId: id,
              error: "Task failed",
            });
          }
          return updated;
        }),

      cancel: (id) =>
        Effect.gen(function* () {
          const m = yield* Ref.get(store);
          if (!m.has(id)) {
            return yield* Effect.fail(
              new TaskError({ taskId: id, message: `Task ${id} not found` }),
            );
          }
          yield* Ref.update(store, (m) => {
            const next = new Map(m);
            next.set(id, { ...next.get(id)!, status: "cancelled" as const });
            return next;
          });
        }),
    };
  }),
);
```

---

## Context Window Manager

### File: `src/services/context-window-manager.ts`

Moved from "Extension 5 (Phase 3 deferred)" to Core Phase 1. Required by the execution engine
for building prompts that respect model context windows.

```typescript
import { Effect, Context, Layer } from "effect";
import type { LLMMessage } from "../../llm-provider/src/types.js"; // resolved at runtime
import { RuntimeError } from "../errors/errors.js";

// ─── Truncation Strategy ───

export type TruncationStrategy =
  | "drop-oldest" // Remove oldest messages first
  | "drop-middle" // Keep first + last, drop middle
  | "summarize-oldest"; // Summarize oldest messages (requires LLM — future Phase 2)

// ─── Context Error ───

export class ContextError extends Data.TaggedError("ContextError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ─── Service Tag ───

export class ContextWindowManager extends Context.Tag("ContextWindowManager")<
  ContextWindowManager,
  {
    /**
     * Build a context-window-safe message array.
     * Injects memory context as a system message and truncates if needed.
     */
    readonly buildContext: (options: {
      systemPrompt: string;
      messages: readonly unknown[]; // LLMMessage[]
      memoryContext?: string; // MemoryBootstrapResult.semanticContext
      maxTokens: number;
      reserveOutputTokens: number; // Tokens to reserve for model output
    }) => Effect.Effect<readonly unknown[], ContextError>; // LLMMessage[]

    /**
     * Estimate token count for a string.
     * Uses character-based heuristic (1 token ≈ 4 chars) when no tokenizer available.
     */
    readonly estimateTokens: (text: string) => Effect.Effect<number, never>;

    /**
     * Check if a message array fits within the context limit.
     */
    readonly fitsInContext: (
      messages: readonly unknown[],
      maxTokens: number,
    ) => Effect.Effect<boolean, never>;

    /**
     * Truncate messages to fit within targetTokens.
     */
    readonly truncate: (
      messages: readonly unknown[],
      targetTokens: number,
      strategy: TruncationStrategy,
    ) => Effect.Effect<readonly unknown[], ContextError>;
  }
>() {}

// ─── Live Implementation ───

export const ContextWindowManagerLive = Layer.succeed(ContextWindowManager, {
  estimateTokens: (text) =>
    // Heuristic: ~4 chars per token (works reasonably for English)
    Effect.succeed(Math.ceil(text.length / 4)),

  fitsInContext: (messages, maxTokens) =>
    Effect.gen(function* () {
      const svc = yield* ContextWindowManager;
      const text = JSON.stringify(messages);
      const estimated = yield* svc.estimateTokens(text);
      return estimated <= maxTokens;
    }),

  truncate: (messages, targetTokens, strategy) =>
    Effect.gen(function* () {
      const svc = yield* ContextWindowManager;
      const arr = [...messages] as unknown[];

      if (arr.length <= 1) return arr;

      switch (strategy) {
        case "drop-oldest": {
          while (arr.length > 1) {
            const fits = yield* svc.fitsInContext(arr, targetTokens);
            if (fits) break;
            arr.shift(); // Remove oldest
          }
          return arr;
        }
        case "drop-middle": {
          while (arr.length > 2) {
            const fits = yield* svc.fitsInContext(arr, targetTokens);
            if (fits) break;
            const mid = Math.floor(arr.length / 2);
            arr.splice(mid, 1); // Remove middle message
          }
          return arr;
        }
        default:
          return yield* Effect.fail(
            new ContextError({
              message: `Truncation strategy '${strategy}' not implemented in Phase 1`,
            }),
          );
      }
    }),

  buildContext: (options) =>
    Effect.gen(function* () {
      const svc = yield* ContextWindowManager;
      const budget = options.maxTokens - options.reserveOutputTokens;

      // Build system message with memory context injected
      const systemContent = options.memoryContext
        ? `${options.systemPrompt}\n\n## Agent Memory\n${options.memoryContext}`
        : options.systemPrompt;

      const systemMsg = { role: "system", content: systemContent };
      const systemTokens = yield* svc.estimateTokens(systemContent);
      const conversationBudget = budget - systemTokens;

      // Truncate conversation to fit budget
      const truncated = yield* svc.truncate(
        options.messages,
        conversationBudget,
        "drop-oldest",
      );

      return [systemMsg, ...truncated];
    }),
});
```

---

## Runtime Layer

### File: `src/runtime.ts`

```typescript
import { Layer } from "effect";
import { EventBusLive } from "./services/event-bus.js";
import { AgentServiceLive } from "./services/agent-service.js";
import { TaskServiceLive } from "./services/task-service.js";
import { ContextWindowManagerLive } from "./services/context-window-manager.js";

/**
 * Complete core services layer.
 * Provides: EventBus, AgentService, TaskService, ContextWindowManager
 *
 * Usage:
 *   myProgram.pipe(Effect.provide(CoreServicesLive))
 */
export const CoreServicesLive = Layer.mergeAll(
  AgentServiceLive,
  TaskServiceLive,
  ContextWindowManagerLive,
).pipe(Layer.provide(EventBusLive));
```

---

## Public API

### File: `src/index.ts`

```typescript
// ─── Types ───
export type {
  Agent,
  AgentConfig,
  AgentId,
  Capability,
  ReasoningStrategy,
  MemoryType,
} from "./types/agent.js";
export type {
  Task,
  TaskConfig,
  TaskId,
  TaskType,
  Priority,
  TaskStatus,
  TaskMetadata,
} from "./types/task.js";
export type {
  TaskResult,
  ResultMetadata,
  ReasoningStep,
  StepType,
} from "./types/result.js";
export type { Message, MessageId, MessageType } from "./types/message.js";
export type {
  RuntimeConfig,
  LogLevel,
  TelemetryConfig,
} from "./types/config.js";

// ─── Schemas ───
export {
  AgentSchema,
  AgentConfigSchema,
  CapabilitySchema,
} from "./types/agent.js";
export {
  TaskSchema,
  TaskConfigSchema,
  TaskMetadataSchema,
} from "./types/task.js";
export {
  TaskResultSchema,
  ResultMetadataSchema,
  ReasoningStepSchema,
} from "./types/result.js";
export { MessageSchema } from "./types/message.js";
export { RuntimeConfigSchema, defaultRuntimeConfig } from "./types/config.js";

// ─── Services ───
export { AgentService, AgentServiceLive } from "./services/agent-service.js";
export { TaskService, TaskServiceLive } from "./services/task-service.js";
export { EventBus, EventBusLive } from "./services/event-bus.js";
export type { AgentEvent, EventHandler } from "./services/event-bus.js";
export {
  ContextWindowManager,
  ContextWindowManagerLive,
} from "./services/context-window-manager.js";
export type { TruncationStrategy } from "./services/context-window-manager.js";

// ─── Errors ───
export {
  AgentError,
  AgentNotFoundError,
  TaskError,
  ValidationError,
  RuntimeError,
} from "./errors/errors.js";

// ─── IDs ───
export { generateAgentId, generateTaskId, generateMessageId } from "./id.js";

// ─── Runtime ───
export { CoreServicesLive } from "./runtime.js";
```

---

## Testing

### File: `tests/agent-service.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { AgentService, CoreServicesLive } from "../src/index.js";

describe("AgentService", () => {
  const run = <A, E>(effect: Effect.Effect<A, E, AgentService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(CoreServicesLive)));

  it("should create an agent", async () => {
    const agent = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        return yield* svc.create({ name: "TestAgent", capabilities: [] });
      }),
    );

    expect(agent.name).toBe("TestAgent");
    expect(agent.id).toBeDefined();
  });

  it("should get an agent by id", async () => {
    const found = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        const created = yield* svc.create({ name: "Finder", capabilities: [] });
        return yield* svc.get(created.id);
      }),
    );

    expect(found.name).toBe("Finder");
  });

  it("should fail for missing agent", async () => {
    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        return yield* svc.get("nonexistent" as any);
      }).pipe(Effect.provide(CoreServicesLive)),
    );

    expect(result._tag).toBe("Failure");
  });

  it("should list agents", async () => {
    const agents = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        yield* svc.create({ name: "A1", capabilities: [] });
        yield* svc.create({ name: "A2", capabilities: [] });
        return yield* svc.list();
      }),
    );

    expect(agents.length).toBe(2);
  });

  it("should delete an agent", async () => {
    const agents = await run(
      Effect.gen(function* () {
        const svc = yield* AgentService;
        const a = yield* svc.create({ name: "ToDelete", capabilities: [] });
        yield* svc.delete(a.id);
        return yield* svc.list();
      }),
    );

    expect(agents.length).toBe(0);
  });
});
```

---

## Configuration

### File: `package.json`

```json
{
  "name": "@reactive-agents/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "effect": "^3.10.0",
    "ulid": "^2.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

---

## Performance Targets

| Operation        | Target | Notes                |
| ---------------- | ------ | -------------------- |
| Agent creation   | <10ms  | p95, in-memory       |
| Task submission  | <5ms   | p95, in-memory       |
| Event publish    | <1ms   | p95, per subscriber  |
| Effect overhead  | <1ms   | p95, per composition |
| Memory per agent | <1MB   | average              |

---

## Success Criteria

- [ ] All types defined with Schema (not plain interfaces)
- [ ] All errors use Data.TaggedError
- [ ] All services use Context.Tag + Layer.effect
- [ ] CoreServicesLive provides all services in one layer
- [ ] EventBus supports pub/sub with tag filtering
- [ ] Agent CRUD operations work
- [ ] Task lifecycle works (create → update status → cancel)
- [ ] All tests pass with >80% coverage
- [ ] IDs are ULID-based branded types

---

## Dependencies

**Requires:** Nothing (foundation layer)

**Provides to:**

- Layer 1.5 (LLM Provider): Task, Agent types, EventBus
- Layer 2 (Memory): Agent, Task types, errors
- Layer 3 (Reasoning): Task, ReasoningStep, errors
- All other layers: Error types, EventBus, Config

**Status: Ready for AI agent implementation**
**Priority: Phase 1A (Week 1)**
