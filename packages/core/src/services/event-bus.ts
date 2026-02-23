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
  // ─── LLM events (from @reactive-agents/llm-provider) ───
  | {
      readonly _tag: "LLMRequestCompleted";
      readonly taskId: string;
      readonly requestId: string;
      readonly model: string;
      readonly provider: string;
      readonly durationMs: number;
      readonly tokensUsed: number;
      readonly estimatedCost: number;
    }
  // ─── Tool execution events (from @reactive-agents/runtime) ───
  | {
      readonly _tag: "ToolCallStarted";
      readonly taskId: string;
      readonly toolName: string;
      readonly callId: string;
    }
  | {
      readonly _tag: "ToolCallCompleted";
      readonly taskId: string;
      readonly toolName: string;
      readonly callId: string;
      readonly durationMs: number;
      readonly success: boolean;
    }
  // ─── Phase completion events (from @reactive-agents/runtime) ───
  | {
      readonly _tag: "ExecutionPhaseCompleted";
      readonly taskId: string;
      readonly phase: string;
      readonly durationMs: number;
    }
  // ─── Reasoning step events (from @reactive-agents/reasoning) ───
  | {
      readonly _tag: "ReasoningStepCompleted";
      readonly taskId: string;
      readonly strategy: string;
      readonly step: number;
      readonly totalSteps: number;
      readonly thought?: string;
      readonly action?: string;
      readonly observation?: string;
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
      publish: (event: AgentEvent) =>
        Effect.gen(function* () {
          const hs = yield* Ref.get(handlers);
          yield* Effect.all(
            hs.map((h) => h(event)),
            { concurrency: "unbounded" },
          );
        }),

      subscribe: (handler: EventHandler) =>
        Effect.gen(function* () {
          yield* Ref.update(handlers, (hs) => [...hs, handler]);
          return () => {
            Effect.runSync(
              Ref.update(handlers, (hs) => hs.filter((h) => h !== handler)),
            );
          };
        }),

      on: (tag: AgentEvent["_tag"], handler: EventHandler) =>
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
