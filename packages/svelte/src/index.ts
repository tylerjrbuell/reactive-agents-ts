/**
 * @reactive-agents/svelte — Svelte stores for agent UI integration.
 *
 * @unstable All exports unstable. SSE contract hand-coupled to runtime via
 * `_tag` strings, so a runtime change can break it silently. Covered by unit
 * tests, but the tier stays unstable: may change in any release without
 * notice. See AUDIT-overhaul-2026.md §11 #42.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { createAgentStream } from "@reactive-agents/svelte";
 *   const agent = createAgentStream("/api/agent");
 * </script>
 *
 * <button on:click={() => agent.run("Explain quantum computing")}>Ask</button>
 * <p>{$agent.text}</p>
 * {#if $agent.status === "streaming"}<span>●</span>{/if}
 * ```
 */
export { createAgentStream } from "./agent-stream.js";
export { createAgent } from "./agent.js";
export { createStructuredStream } from "./structured-stream.js";
export { parsePartialObject } from "./parse-partial.js";
export { createRun, type CreateRunOptions, type RunStore } from "./run.js";
export { createResumableRun, type CreateResumableRunOptions } from "./resumable.js";
export { createInteractions, type CreateInteractionsOptions, type InteractionsStore } from "./interactions.js";
export { runCost, runSteps, type StepEntry } from "./observe.js";
export type { AgentStreamState } from "./agent-stream.js";
export type { AgentState } from "./agent.js";
export type { StructuredStreamState } from "./structured-stream.js";
export type {
  AgentStreamEvent,
  AgentHookState,
  UseAgentReturn,
  UseAgentStreamReturn,
} from "./types.js";
export type { RunState, UiStreamEvent, UiRunStatus, PendingInteractionWire } from "@reactive-agents/ui-core";

/**
 * Shared display helpers from `@reactive-agents/ui-core`: cost, token and time
 * formatters and the one status vocabulary (running / attention / done / failed /
 * stopped / idle), so an app's chat UI shows the same states the same way.
 */
export {
  formatCost,
  formatTokens,
  formatRelativeTime,
  formatClockTime,
  formatTurnDuration,
  statusOfTurn,
  statusOfRun,
  statusOfSubAgent,
  modelWaitLabel,
  type StatusTone,
  type StatusView,
  type TimeFormatOptions,
} from "@reactive-agents/ui-core";
