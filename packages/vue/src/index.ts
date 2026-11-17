/**
 * @reactive-agents/vue — Vue 3 composables for agent UI integration.
 *
 * @unstable All exports unstable. SSE contract hand-coupled to runtime via
 * `_tag` strings, so a runtime change can break it silently. Covered by unit
 * tests, but the tier stays unstable: may change in any release without
 * notice. See AUDIT-overhaul-2026.md §11 #42.
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
export { useStructuredObject } from "./use-structured-object.js";
export { parsePartialObject } from "./parse-partial.js";
export type { AgentStreamEvent, AgentHookState } from "./types.js";

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
