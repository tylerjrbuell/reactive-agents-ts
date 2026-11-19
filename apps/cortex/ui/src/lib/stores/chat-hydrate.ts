import type { AttachmentMeta, ChecklistSnapshotWire, PersistedReasoningStep, PersistedSubAgent, RecalledMemoryView, RunNotes, RunSkillsView, StrategyRunState, TurnDeliverable, TurnStructured, TurnUsage } from "@reactive-agents/ui-core";
import { restoreSubAgents } from "../sub-agent-view.js";
import { storedRunEnding, type TurnRunEnding } from "../turn-ending.js";
import type { ChatToolCall, ChatTurn } from "./chat-store.js";

/** Server-persisted thinking + tool-call detail for a finished assistant turn. */
type PersistedTrace = {
  reasoningSteps?: ReadonlyArray<PersistedReasoningStep>;
  toolCalls?: ReadonlyArray<Omit<ChatToolCall, "status"> & { status: "done" | "failed" }>;
  subAgents?: ReadonlyArray<PersistedSubAgent>;
  checklist?: ChecklistSnapshotWire;
  /** Present only when the turn's run did not succeed (server `StoredTurnOutcome`). */
  outcome?: { success: false } & TurnRunEnding;
  /** Receipt deliverables, when the run listed any. */
  deliverables?: readonly TurnDeliverable[];
  /** Per-call usage evidence persisted by the recorder fold. */
  usage?: TurnUsage;
  /** Strategy the run reported. */
  strategy?: string;
  /** Reported run duration (ms). */
  durationMs?: number;
  /** Skills the run had active and why. */
  skills?: RunSkillsView;
  /** Memories the run recalled (`MemoryRecalled`); [] = it looked and recalled nothing. */
  recalled?: readonly RecalledMemoryView[];
  /** The typed object and how it was obtained, for a turn run with an output schema. */
  structured?: TurnStructured;
  /** Attachments of a user message (names and sizes). */
  attachments?: readonly AttachmentMeta[];
  /** The strategy's settled phases, so its card outlives the turn and a reload (absent on older rows). */
  strategyRun?: StrategyRunState;
  /** How the run ended beyond success or failure: to-do outcome, unread-results note, authority (absent on older rows). */
  runNotes?: RunNotes;
};

/** Rebuild a ChatTurn from a server row, restoring reasoning steps + tool calls so history is inspectable after reload. */
export function hydrateTurn(row: ChatTurn & { trace?: PersistedTrace }): ChatTurn {
  const { trace, ...turn } = row;
  // A stored assistant row is written when its run ends, so its `ts` is the finish time.
  const finished = turn.role === "assistant" && turn.ts > 0 ? { finishedAt: turn.ts } : {};
  if (!trace) return { ...turn, ...finished };
  return {
    ...turn,
    ...finished,
    ...(typeof trace.durationMs === "number" ? { durationMs: trace.durationMs } : {}),
    ...(trace.reasoningSteps && trace.reasoningSteps.length > 0
      ? {
          reasoningSteps: trace.reasoningSteps.map((r) => ({
            iteration: r.iteration,
            maxIterations: 0,
            thought: r.thought,
            ...(r.narration ? { narration: r.narration } : {}),
            ...(r.thinking ? { thinking: r.thinking } : {}),
          })),
        }
      : {}),
    ...(trace.toolCalls && trace.toolCalls.length > 0 ? { toolCalls: trace.toolCalls.map((c) => ({ ...c })) } : {}),
    ...(trace.subAgents && trace.subAgents.length > 0 ? { subAgents: restoreSubAgents(trace.subAgents) } : {}),
    ...(trace.checklist ? { checklist: trace.checklist } : {}),
    ...(trace.outcome?.success === false ? { runFailed: storedRunEnding(trace.outcome) } : {}),
    // A turn the user stopped reads as stopped after a reload, as it did live.
    ...(trace.outcome?.ending === "interrupted" && trace.outcome.interruptedBy === "user" ? { cancelled: true } : {}),
    ...(trace.deliverables && trace.deliverables.length > 0 ? { deliverables: trace.deliverables } : {}),
    ...(trace.usage ? { usage: trace.usage } : {}),
    ...(trace.strategy ? { strategy: trace.strategy } : {}),
    ...(trace.skills && trace.skills.activations.length > 0 ? { skills: trace.skills } : {}),
    ...(trace.recalled ? { recalled: trace.recalled } : {}),
    ...(trace.structured ? { structured: trace.structured } : {}),
    ...(trace.attachments && trace.attachments.length > 0 ? { attachments: trace.attachments } : {}),
    ...(trace.strategyRun ? { strategyRun: trace.strategyRun } : {}),
    ...(trace.runNotes ? { runNotes: trace.runNotes } : {}),
  };
}
