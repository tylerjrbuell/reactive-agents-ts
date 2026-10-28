import { Effect, Context, Layer, Ref } from "effect";
import type { AgentEvent, AgentEventTag, EventHandler, TypedEventHandler } from "../types/agent-event.js";

// Event type definitions live in `types/agent-event.ts`; re-exported here so existing
// `services/event-bus` importers keep working.
export type * from "../types/agent-event.js";


// ─── Service Tag ───

/**
 * EventBus service — central publish-subscribe hub for all agent lifecycle events.
 * Enables decoupled observability, metrics collection, tracing, and custom integrations.
 * All events flow through EventBus: task lifecycle, execution phases, LLM requests, tool calls, memory events, etc.
 *
 * Consumers subscribe via `on(tag, handler)` for type-safe tag-filtered subscriptions
 * or `subscribe(handler)` for a catch-all handler receiving every event.
 * Publishers call `publish(event)` to broadcast an `AgentEvent` to all current subscribers.
 *
 * @example
 * ```typescript
 * const bus = yield* EventBus;
 * yield* bus.publish({
 *   _tag: "AgentStarted",
 *   taskId: "task-123",
 *   agentId: "agent-456",
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   timestamp: Date.now()
 * });
 *
 * const unsub = yield* bus.on("AgentCompleted", (event) => {
 *   return Effect.sync(() => console.log(event.totalTokens));
 * });
 * ```
 *
 * @see AgentEvent — union of all event variants the bus can carry
 * @see EventBusLive — default Effect-TS Layer implementation
 * @see TypedEventHandler — type for tag-filtered event handlers
 */
export class EventBus extends Context.Tag("EventBus")<
  EventBus,
  {
    /**
     * Publish an event to all subscribed handlers.
     * All handlers execute concurrently; failures in one do not prevent others from running.
     *
     * @param event — The AgentEvent to broadcast
     * @returns Effect that resolves only once ALL handlers have completed — the
     *   implementation awaits `Effect.all(handlers, { concurrency: "unbounded" })`, so
     *   handlers run concurrently with each other but `publish` itself is NOT
     *   fire-and-forget. Downstream ordering guarantees depend on this — e.g. the
     *   `LedgerEntryAppended` → ledger-entry stream projection (Wave C.1) assumes a
     *   published entry is fully observed by its tap before `publish` returns. Do not
     *   change this to return before handlers complete without revisiting those
     *   guarantees.
     *
     * @example
     * ```typescript
     * yield* bus.publish({ _tag: "TaskCreated", taskId: "task-123" });
     * ```
     */
    readonly publish: (event: AgentEvent) => Effect.Effect<void, never>;

    /**
     * Subscribe a catch-all handler for all events.
     * Handler receives every event published on the bus.
     *
     * @param handler — Function to invoke for every event
     * @returns Effect that yields an unsubscribe function. Call the returned function to stop listening.
     *
     * @example
     * ```typescript
     * const unsub = yield* bus.subscribe((event) => {
     *   return Effect.sync(() => console.log("Event:", event._tag));
     * });
     * // Later:
     * unsub();
     * ```
     */
    readonly subscribe: (
      handler: EventHandler,
    ) => Effect.Effect<() => void, never>;

    /**
     * Subscribe a handler to events matching a specific tag.
     * Type-safe: the handler receives only events of the specified tag, automatically narrowed.
     * No `_tag` type guard needed inside the handler.
     *
     * @typeParam T — The AgentEventTag to filter on
     * @param tag — Event discriminant (e.g., "AgentCompleted", "ToolCallStarted")
     * @param handler — Function receiving the narrowed event type
     * @returns Effect that yields an unsubscribe function
     *
     * @example
     * ```typescript
     * const unsub = yield* bus.on("AgentCompleted", (event) => {
     *   // event: { _tag: "AgentCompleted"; totalTokens: number; ... }
     *   return Effect.sync(() => console.log("Tokens:", event.totalTokens));
     * });
     *
     * const unsub2 = yield* bus.on("ToolCallStarted", (event) => {
     *   // event: { _tag: "ToolCallStarted"; toolName: string; ... }
     *   return Effect.sync(() => console.log("Tool:", event.toolName));
     * });
     * ```
     */
    readonly on: <T extends AgentEventTag>(
      tag: T,
      handler: TypedEventHandler<T>,
    ) => Effect.Effect<() => void, never>;
  }
>() {}

// ─── Live Implementation ───

/**
 * EventBusLive — default Effect-TS Layer implementation of EventBus.
 * Uses an Effect Ref to maintain subscriber list.
 * All handlers execute concurrently with unbounded concurrency per publish call.
 * Subscribers are stored as closures, so identity (===) is used for unsubscribe.
 *
 * @example
 * ```typescript
 * const runtime = yield* Effect.provide(EventBusLive)(myEffect);
 * ```
 */
export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const handlers = yield* Ref.make<EventHandler[]>([]);

    return {
      /**
       * Publish implementation — broadcasts event to all registered handlers concurrently.
       * Failures in individual handlers do not stop other handlers from running.
       *
       * @internal
       */
      publish: (event: AgentEvent) =>
        Effect.gen(function* () {
          const hs = yield* Ref.get(handlers);
          yield* Effect.all(
            hs.map((h) => h(event)),
            { concurrency: "unbounded" },
          );
        }),

      /**
       * Subscribe implementation — registers a catch-all handler.
       * Calls Ref.update to append handler to list.
       * Returns unsubscribe function via Effect.runSync.
       *
       * @internal
       */
      subscribe: (handler: EventHandler) =>
        Effect.gen(function* () {
          yield* Ref.update(handlers, (hs) => [...hs, handler]);
          return () => {
            Effect.runSync(
              Ref.update(handlers, (hs) => hs.filter((h) => h !== handler)),
            );
          };
        }),

      /**
       * On implementation — registers a tag-filtered handler.
       * Creates a wrapper handler that only calls the user's handler if event._tag matches.
       * Type cast is safe because the filter guarantees the tag matches.
       *
       * @internal
       */
      on: <T extends AgentEventTag>(tag: T, handler: TypedEventHandler<T>) =>
        Effect.gen(function* () {
          // The outer filter ensures `event._tag === tag` before calling handler,
          // so the cast to the narrowed type is always safe.
          const filtered: EventHandler = (event) =>
            event._tag === tag
              ? handler(event as Extract<AgentEvent, { _tag: T }>)
              : Effect.void;
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
