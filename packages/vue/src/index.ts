/**
 * @reactive-agents/vue
 *
 * Vue 3 composables for consuming Reactive Agents from client-side components.
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
