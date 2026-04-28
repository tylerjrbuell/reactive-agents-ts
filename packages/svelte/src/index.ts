/**
 * @reactive-agents/svelte — Svelte stores for agent UI integration.
 *
 * @unstable All exports unstable. Zero in-repo consumers, zero tests, SSE
 * contract hand-coupled to runtime via `_tag` strings — runtime change breaks
 * silently. May change in v0.10.x without notice.
 * See AUDIT-overhaul-2026.md §11 #42.
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
export type { AgentStreamState } from "./agent-stream.js";
export type { AgentState } from "./agent.js";
export type {
  AgentStreamEvent,
  AgentHookState,
  UseAgentReturn,
  UseAgentStreamReturn,
} from "./types.js";
