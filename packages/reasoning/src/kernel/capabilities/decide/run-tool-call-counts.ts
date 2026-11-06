/**
 * The ONE run-wide count behind `maxCallsPerTool`.
 *
 * A run's calls reach tools two ways: the think-phase tool gate of a kernel
 * pass (`tool-call-refusals.ts` → `tool-gating.ts`), and direct dispatch with
 * no kernel and no model turn (`tool-call-budget.ts`: plan `tool_call` steps,
 * code-action's sandbox bridge). Both read and charge this count, a run slot,
 * so a run with several kernel passes (reflexion improve, plan-execute
 * composite steps, a strategy switch, a second strategy run) or a mix of
 * direct dispatch and kernel passes cannot exceed a cap. A sub-agent's run
 * gets its own count (`reset`): its calls are not charged against the
 * parent's caps.
 *
 * Only capped tools are counted, and a call is counted when it is admitted
 * (the gate let it through, or the budget reserved it), not when it succeeds.
 */
import { Effect } from "effect";
import { currentRunContext, getRunSlot, runSlot, type RunSlot } from "@reactive-agents/core/internal/run-scope";

/** Calls admitted so far this run, per capped tool. Mutated in place (synchronous check-and-count). */
export type ToolCallCounts = Map<string, number>;

/** The run's call counts (reset for sub-agents: a child's calls are its own). */
export const toolCallCountsSlot: RunSlot<ToolCallCounts> = runSlot<ToolCallCounts>("reasoning.toolCallCounts", {
  child: "reset",
  fresh: () => new Map(),
});

/**
 * The active run's call counts, or `null` outside a run scope. The slot's
 * process fallback would be shared by every unscoped kernel in the process,
 * so an unscoped caller counts on its own (a bare kernel pass is its own run).
 */
export const runToolCallCounts: Effect.Effect<ToolCallCounts | null> = Effect.flatMap(currentRunContext, (run) =>
  run === null ? Effect.succeed(null) : getRunSlot(toolCallCountsSlot),
);

/** Count one admitted call to `toolName`. */
export const chargeToolCall = (counts: ToolCallCounts, toolName: string): void => {
  counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
};
