import {
  findSubAgentGroup,
  goalSummaryOf,
  subAgentCardOf,
  visibleThoughts,
  type ChecklistSnapshotWire,
  type PersistedSubAgent,
  type SubAgentCard,
  type SubAgentTrace,
  type TurnEnding,
  type TurnOutcome,
  type TurnTrace,
} from "@reactive-agents/ui-core";
import type { ChatTurn } from "./stores/chat-store.js";

/**
 * One sub-agent as the chat renders it. Its `turn` is a synthetic assistant turn,
 * so the EXISTING transcript components (`ChatTranscript`) render a child's
 * narration / tool groups / grandchildren with no second code path.
 */
export interface ChatSubAgent {
  /** Stable key: the child's task id (`run.key`), the suffix of its live checklist group key. */
  readonly key: string;
  readonly name: string;
  readonly depth: number;
  readonly status: "running" | "done" | "failed";
  /** How the child's run ended (abstained, partial, …), when it reported. */
  readonly ending?: TurnEnding;
  /** Why it failed or abstained, when reported. */
  readonly reason?: string;
  /** Strategy the child's run reported. */
  readonly strategy?: string;
  /** 0 when the lifecycle start was never seen. */
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly output?: string;
  readonly turn: ChatTurn;
}

const childTurn = (over: Partial<ChatTurn>): ChatTurn => ({ id: 0, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });

const endingOf = (o: TurnOutcome | undefined): { ending?: TurnEnding; reason?: string } => {
  if (o === undefined) return {};
  const reason = o.abstention?.reason ?? o.error;
  return { ending: o.ending, ...(reason ? { reason } : {}) };
};

/**
 * A finished child that did not succeed, as the run ending its synthetic turn carries, so the
 * drill-in transcript closes with the same ending note (and summary outcome) as a top-level turn.
 */
const childRunFailed = (status: ChatSubAgent["status"], o: TurnOutcome | undefined): Pick<ChatTurn, "runFailed"> => {
  if (status !== "failed") return {};
  const ending = o?.ending === "partial" || o?.ending === "abstained" ? o.ending : "failed";
  return {
    runFailed: {
      ending,
      ...(o?.error ? { error: o.error } : {}),
      ...(o?.terminatedBy ? { terminatedBy: o.terminatedBy } : {}),
      ...(o?.abstention ? { abstention: o.abstention } : {}),
      ...(o?.unfinished ? { unfinished: o.unfinished } : {}),
    },
  };
};

/** Project live fold output (`TurnTraceState.subAgents`) into chat sub-agents, in start order. */
export function projectSubAgents(blocks: Readonly<Record<string, SubAgentTrace>>): ChatSubAgent[] {
  return Object.entries(blocks).map(([key, b]): ChatSubAgent => {
    const thoughts = visibleThoughts(b.trace);
    const nested = projectSubAgents(b.trace.subAgents);
    const running = b.status === "running";
    return {
      key,
      name: b.run.name,
      depth: b.run.depth,
      status: b.status,
      ...endingOf(b.trace.outcome),
      ...(b.trace.strategy !== undefined ? { strategy: b.trace.strategy } : {}),
      startedAt: b.startedAt,
      ...(b.endedAt !== undefined ? { endedAt: b.endedAt } : {}),
      ...(b.tokens !== undefined ? { tokens: b.tokens } : {}),
      ...(b.costUsd !== undefined ? { costUsd: b.costUsd } : {}),
      ...(b.output !== undefined ? { output: b.output } : {}),
      turn: childTurn({
        streaming: running,
        content: b.output ?? "",
        ...(running && b.trace.pending.length > 0 ? { liveText: b.trace.pending } : {}),
        reasoningSteps: Object.keys(thoughts)
          .map(Number)
          .sort((x, y) => x - y)
          .map((iteration) => ({ iteration, maxIterations: 0, thought: thoughts[iteration]! })),
        toolCalls: [...b.trace.calls],
        ...childRunFailed(b.status, b.trace.outcome),
        ...(b.trace.checklist !== undefined ? { checklist: b.trace.checklist } : {}),
        ...(b.trace.strategy !== undefined ? { strategy: b.trace.strategy } : {}),
        ...(nested.length > 0 ? { subAgents: nested } : {}),
      }),
    };
  });
}

/** Restore persisted children (finished turn rows) into chat sub-agents, recursively. */
export function restoreSubAgents(persisted: readonly PersistedSubAgent[] | undefined): ChatSubAgent[] {
  return (persisted ?? []).map((p, i): ChatSubAgent => {
    const t: TurnTrace = p.trace;
    const nested = restoreSubAgents(t.subAgents);
    return {
      // Older traces may lack `run.key`; the run id + position keeps keys unique.
      key: p.run.key ?? `${p.run.runId}#${i}`,
      name: p.run.name,
      depth: p.run.depth,
      status: p.status,
      ...endingOf(t.outcome),
      ...(t.strategy !== undefined ? { strategy: t.strategy } : {}),
      startedAt: p.startedAt,
      ...(p.endedAt !== undefined ? { endedAt: p.endedAt } : {}),
      ...(p.tokens !== undefined ? { tokens: p.tokens } : {}),
      ...(p.costUsd !== undefined ? { costUsd: p.costUsd } : {}),
      ...(p.output !== undefined ? { output: p.output } : {}),
      turn: childTurn({
        content: p.output ?? "",
        reasoningSteps: t.reasoningSteps.map((r) => ({
          iteration: r.iteration,
          maxIterations: 0,
          thought: r.thought,
          ...(r.narration ? { narration: r.narration } : {}),
          ...(r.thinking ? { thinking: r.thinking } : {}),
        })),
        toolCalls: t.toolCalls.map((c) => ({ ...c })),
        ...childRunFailed(p.status, t.outcome),
        ...(t.checklist !== undefined ? { checklist: t.checklist } : {}),
        ...(t.strategy !== undefined ? { strategy: t.strategy } : {}),
        ...(nested.length > 0 ? { subAgents: nested } : {}),
      }),
    };
  });
}

/**
 * The compact card for one sub-agent (ui-core `subAgentCardOf`). Goal status comes
 * from the child's own checklist, else from its group in the parent's checklist.
 * `now` (epoch ms) times a child that still runs.
 */
export function subAgentCard(agent: ChatSubAgent, now: number, parentChecklist?: ChecklistSnapshotWire): SubAgentCard {
  const group = agent.turn.checklist?.root ?? (parentChecklist ? findSubAgentGroup(parentChecklist.root, agent) : undefined);
  const goals = group ? goalSummaryOf(group, { ended: agent.status !== "running" }).status : undefined;
  const steps = agent.turn.reasoningSteps ?? [];
  const narration = [...steps].reverse().find((s) => (s.narration ?? s.thought ?? "").trim() !== "");
  return subAgentCardOf(
    {
      name: agent.name,
      status: agent.status,
      ...(agent.ending !== undefined ? { ending: agent.ending } : {}),
      ...(agent.reason !== undefined ? { reason: agent.reason } : {}),
      startedAt: agent.startedAt,
      ...(agent.endedAt !== undefined ? { endedAt: agent.endedAt } : {}),
      ...(agent.costUsd !== undefined ? { costUsd: agent.costUsd } : {}),
      calls: agent.turn.toolCalls ?? [],
      ...(narration ? { narration: narration.narration ?? narration.thought ?? "" } : {}),
      ...(agent.output !== undefined ? { output: agent.output } : {}),
      ...(goals !== undefined ? { goals } : {}),
      ...(agent.strategy !== undefined ? { strategy: agent.strategy } : {}),
    },
    now,
  );
}
