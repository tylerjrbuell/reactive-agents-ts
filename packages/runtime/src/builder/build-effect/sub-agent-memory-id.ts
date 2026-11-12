/**
 * The memory identity of a sub-agent, separate from its correlation id.
 *
 * A sub-agent's runtime `agentId` is unique per spawn (`sub-<name>-<epoch>`):
 * events, traces and logs need that to tell two spawns apart. The memory store
 * is named from the same id, so every spawn created a new store (27,000
 * folders). Memory identity is parent-scoped and stable instead:
 * `sub-<parentAgentId>-<name>`. The same named sub-agent of the same parent
 * reuses one store across spawns; correlation ids stay unique.
 *
 * One home for both delegation paths (`sub-agent-executor.ts`,
 * `local-agent-tools.ts`).
 */

/** Stable, parent-scoped memory id for the sub-agent called `name`. Pure. */
export const subAgentMemoryId = (parentAgentId: string, name: string): string =>
  `sub-${parentAgentId}-${name}`;
