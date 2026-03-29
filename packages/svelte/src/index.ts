/**
 * @reactive-agents/svelte
 *
 * Svelte stores for consuming Reactive Agents from client-side components.
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
export type { AgentStreamState, AgentState } from "./types.js";
