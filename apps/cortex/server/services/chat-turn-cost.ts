import type { StoredTurnTrace } from "./chat-turn-trace.js";

/** What a chat turn cost, and whether that figure can be trusted as complete. */
export interface TurnCost {
  readonly usd: number;
  /** `false` = unpriced, or a lower bound (a failed sub-agent's spend is not folded by the runtime). */
  readonly known: boolean;
}

/** Tools that delegate to a sub-agent (mirrors `SUBAGENT_TOOL_NAMES` in `@reactive-agents/runtime`). */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["spawn-agent", "spawn-agents"]);

/**
 * Cost of one completed turn. A missing cost is unknown (never silently $0). A turn
 * with a failed delegation is a lower bound: the runtime's budget fold does not count
 * a failed child's spend, so the figure may understate and is flagged rather than hidden.
 */
export function turnCostOf(cost: number | undefined, trace: StoredTurnTrace | undefined): TurnCost {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return { usd: 0, known: false };
  const failedChild = trace?.toolCalls.some((c) => c.status === "failed" && SUBAGENT_TOOLS.has(c.name)) ?? false;
  return { usd: cost, known: !failedChild };
}
