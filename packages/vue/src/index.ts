/**
 * @reactive-agents/vue — Vue 3 composables for agent UI integration.
 *
 * @unstable All exports unstable. Zero in-repo consumers, zero tests, SSE
 * contract hand-coupled to runtime via `_tag` strings — runtime change breaks
 * silently. May change in v0.10.x without notice.
 * See AUDIT-overhaul-2026.md §11 #42.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useAgentStream } from "@reactive-agents/vue";
 * const { text, status, run } = useAgentStream("/api/agent");
 * </script>
 * <template>
 *   <button @click="run('Explain quantum computing')">Ask</button>
 *   <p>{{ text }}</p>
 *   <span v-if="status === 'streaming'">●</span>
 * </template>
 * ```
 */
export { useAgentStream } from "./use-agent-stream.js";
export { useAgent } from "./use-agent.js";
export type { AgentStreamEvent, AgentHookState } from "./types.js";
