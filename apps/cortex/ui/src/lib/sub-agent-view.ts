import { visibleThoughts, type PersistedSubAgent, type SubAgentTrace, type TurnTrace } from "@reactive-agents/ui-core";
import type { ChatTurn } from "./stores/chat-store.js";
import { previewArgs } from "./stores/chat-timeline.js";

/**
 * One sub-agent as the chat renders it. Its `turn` is a synthetic assistant turn,
 * so the EXISTING transcript components (`ChatTurnTimeline`) render a child's
 * thinking / tool chips / grandchildren with no second code path.
 */
export interface ChatSubAgent {
  /** Stable key (first run id seen for the child). */
  readonly key: string;
  readonly name: string;
  readonly depth: number;
  readonly status: "running" | "done" | "failed";
  /** 0 when the lifecycle start was never seen. */
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly output?: string;
  readonly turn: ChatTurn;
  /**
   * Link slot for the run trace (plan 2 Task 7): filled with the child's run
   * route once the trace page exists. Not rendered yet.
   */
  readonly traceHref?: string;
}

const childTurn = (over: Partial<ChatTurn>): ChatTurn => ({ id: 0, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });

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
      key: `${p.run.runId}#${i}`,
      name: p.run.name,
      depth: p.run.depth,
      status: p.status,
      startedAt: p.startedAt,
      ...(p.endedAt !== undefined ? { endedAt: p.endedAt } : {}),
      ...(p.tokens !== undefined ? { tokens: p.tokens } : {}),
      ...(p.costUsd !== undefined ? { costUsd: p.costUsd } : {}),
      ...(p.output !== undefined ? { output: p.output } : {}),
      turn: childTurn({
        content: p.output ?? "",
        reasoningSteps: t.reasoningSteps.map((r) => ({ iteration: r.iteration, maxIterations: 0, thought: r.thought })),
        toolCalls: t.toolCalls.map((c) => ({ ...c })),
        ...(nested.length > 0 ? { subAgents: nested } : {}),
      }),
    };
  });
}

/** What the collapsed row needs. */
export interface SubAgentView {
  readonly title: string;
  readonly status: ChatSubAgent["status"];
  readonly elapsedLabel: string;
  readonly toolCount: number;
  readonly costLabel: string;
  /** `3 tools · 12s · $0.004`, unknown parts omitted. */
  readonly summary: string;
  /** Last 3 activity lines while running; the first output line once finished. */
  readonly previewLines: readonly string[];
  readonly children: readonly ChatSubAgent[];
}

const firstLine = (text: string | undefined): string => (text ?? "").split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function activityLines(turn: ChatTurn): string[] {
  const calls = turn.toolCalls ?? [];
  const lines: { iteration: number; order: number; text: string }[] = [
    ...(turn.reasoningSteps ?? [])
      .filter((s) => (s.thought ?? "").trim().length > 0)
      .map((s) => ({ iteration: s.iteration, order: 0, text: oneLine(s.thought!) })),
    ...calls.map((c, i) => ({
      iteration: c.iteration ?? Number.MAX_SAFE_INTEGER,
      order: 1 + i,
      text: `${c.name}${c.args !== undefined ? ` ${previewArgs(c.args, 60)}` : ""}`,
    })),
  ];
  return lines.sort((a, b) => a.iteration - b.iteration || a.order - b.order).map((l) => l.text);
}

const formatSeconds = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

const formatCostLabel = (usd: number): string => `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;

/** Pure view model for a sub-agent block. `now` (epoch ms) times a still-running child. */
export function subAgentView(t: ChatSubAgent, now: number): SubAgentView {
  const toolCount = t.turn.toolCalls?.length ?? 0;
  const elapsedMs =
    t.startedAt > 0 ? (t.endedAt !== undefined ? t.endedAt - t.startedAt : t.status === "running" ? now - t.startedAt : undefined) : undefined;
  const elapsedLabel = elapsedMs !== undefined ? formatSeconds(elapsedMs) : "";
  const costLabel = t.costUsd !== undefined ? formatCostLabel(t.costUsd) : "";
  const previewLines =
    t.status === "running" ? activityLines(t.turn).slice(-3) : firstLine(t.output) !== "" ? [firstLine(t.output)] : [];
  return {
    title: t.name,
    status: t.status,
    elapsedLabel,
    toolCount,
    costLabel,
    summary: [`${toolCount} ${toolCount === 1 ? "tool" : "tools"}`, elapsedLabel, costLabel].filter((p) => p !== "").join(" · "),
    previewLines,
    children: t.turn.subAgents ?? [],
  };
}
