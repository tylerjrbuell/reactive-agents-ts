/**
 * Memories a chat turn's run RECALLED into its context, from what the run
 * reported: its `MemoryRecalled` events (one per non-empty tier at bootstrap, plus
 * later search or tool recalls). {@link recordRecallActivity} keeps them per run so
 * the stream path can store them on the turn trace (`trace.recalled`, ui-core
 * `RecalledMemoryView[]`); ui-core `foldRecalledMemories` reads them, Cortex does
 * not re-derive. A run that reported no `MemoryRecalled` has no `recalled` on its
 * trace, which the Context tab words as "not reported".
 */
import type { AgentEvent } from "@reactive-agents/core";
import { foldRecalledMemories, memoryRecalledOf, type MemoryRecalledLike, type RecalledMemoryView } from "@reactive-agents/ui-core";
import type { SubscribableAgent } from "./chat-ingest.js";
import type { StoredTurnTrace } from "./chat-turn-trace.js";

/** Runs remembered per session; older ones are dropped first. */
const MAX_RUNS = 32;

/** Recall activity of one chat session's runs. */
export interface RecallActivityLog {
  /** The run's recalled memories, or `undefined` when it reported no `MemoryRecalled`. */
  readonly recalledOf: (runId: string | undefined) => RecalledMemoryView[] | undefined;
}

/** Subscribe `agent`; returns the log and its unsubscribe. */
export async function recordRecallActivity(
  agent: SubscribableAgent,
): Promise<{ readonly log: RecallActivityLog; readonly unsubscribe: () => void }> {
  const runs = new Map<string, MemoryRecalledLike[]>();
  const unsubscribe = await agent.subscribe((event: AgentEvent) => {
    if (event._tag !== "MemoryRecalled") return;
    const recalled = memoryRecalledOf(event);
    if (!recalled) return;
    const list = runs.get(event.taskId) ?? [];
    list.push(recalled);
    runs.set(event.taskId, list);
    if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value!);
  });
  return {
    log: {
      recalledOf: (runId) => {
        const events = runId === undefined ? undefined : runs.get(runId);
        return events ? foldRecalledMemories(events) : undefined;
      },
    },
    unsubscribe,
  };
}

/** Attach the run's recalled memories to a turn trace; the trace unchanged when the run reported none. */
export function withTurnRecall(
  trace: StoredTurnTrace | undefined,
  recalled: readonly RecalledMemoryView[] | undefined,
): StoredTurnTrace | undefined {
  if (!recalled) return trace;
  return { ...(trace ?? { reasoningSteps: [], toolCalls: [] }), recalled: [...recalled] };
}
