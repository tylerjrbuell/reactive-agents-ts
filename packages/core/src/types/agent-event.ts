import type { Effect } from "effect";
import type { CoreAgentEvent } from "./events/core-events.js";
import type { PlatformAgentEvent } from "./events/platform-events.js";
import type { HarnessAgentEvent } from "./events/harness-events.js";
import type { ExtensionAgentEvent } from "./events/extension-events.js";

export type {
  LedgerEntryAppendedEvent,
  SignalRenderedEmittedEvent,
  SignalEffectEmittedEvent,
} from "./events/harness-events.js";


/**
 * Union of all possible agent events.
 * Includes task lifecycle, execution phases, LLM requests, tool calls, memory events, reasoning steps, agent lifecycle, and custom events.
 * Each event variant has a discriminant `_tag` field for type narrowing.
 *
 * @example
 * ```typescript
 * const event: AgentEvent = {
 *   _tag: "AgentStarted",
 *   taskId: "task-123",
 *   agentId: "agent-456",
 *   provider: "anthropic",
 *   model: "claude-opus-4-20250514",
 *   timestamp: Date.now()
 * };
 * ```
 */
export type AgentEvent =
  | CoreAgentEvent
  | PlatformAgentEvent
  | HarnessAgentEvent
  | ExtensionAgentEvent;

/**
 * Discriminant tag union of all agent event types.
 * Derived directly from `AgentEvent["_tag"]` so it stays in sync with the union automatically.
 * Useful for writing generic event handlers, type guards, and filtering logic.
 *
 * @example
 * ```typescript
 * function onEvent(tag: AgentEventTag, handler: (event: AgentEvent) => void) {
 *   // tag is strictly one of the 32 event type names
 * }
 * ```
 *
 * @see AgentEvent — the full event union this tag set is derived from
 * @see EventBus.on — typed subscription method that accepts an AgentEventTag
 */
export type AgentEventTag = AgentEvent["_tag"];

/**
 * Typed handler for a specific event.
 * The `event` parameter is automatically narrowed to the matching variant via `Extract<AgentEvent, { _tag: T }>`.
 * No `_tag` type guard needed inside the handler body.
 *
 * @typeParam T — The event tag/discriminant to filter on
 * @param event — The narrowed event object matching tag `T`
 * @returns An Effect that completes when the handler finishes
 *
 * @example
 * ```typescript
 * const handler: TypedEventHandler<"AgentCompleted"> = (event) => {
 *   // event: { _tag: "AgentCompleted"; totalTokens: number; ... }
 *   return Effect.sync(() => console.log(event.totalTokens));
 * };
 * ```
 *
 * @see EventBus.on — pass this handler type to bus.on(tag, handler)
 * @see AgentEventTag — the set of valid values for type parameter T
 */
export type TypedEventHandler<T extends AgentEventTag> = (
  event: Extract<AgentEvent, { _tag: T }>,
) => Effect.Effect<void, never>;

/**
 * Catch-all handler that receives any `AgentEvent`.
 * Used when you want to handle all events uniformly without tag-based filtering.
 * For tag-filtered subscriptions with automatic type narrowing, prefer `TypedEventHandler<T>`.
 *
 * @param event — The full AgentEvent union (no narrowing — discriminate on `event._tag` yourself)
 * @returns An Effect that completes when the handler finishes
 *
 * @see TypedEventHandler — narrowed alternative for tag-specific subscriptions
 * @see EventBus.subscribe — accepts this handler type for catch-all subscriptions
 */
export type EventHandler = (event: AgentEvent) => Effect.Effect<void, never>;
