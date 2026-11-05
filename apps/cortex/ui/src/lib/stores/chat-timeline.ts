import type { ChatToolCall, ChatTurn } from "./chat-store.js";

/** One row of an assistant turn's transcript, in the order it happened. */
export type TimelineItem =
  | { readonly kind: "thought"; readonly iteration: number; readonly text: string }
  | { readonly kind: "tool"; readonly call: ChatToolCall };

/**
 * Interleave an assistant turn's thinking and tool calls the way a conventional
 * agent transcript reads: per iteration, the model's thought first, then the
 * tools it called. Calls with no known iteration trail the rest.
 */
export function buildTimeline(turn: Pick<ChatTurn, "reasoningSteps" | "toolCalls">): TimelineItem[] {
  const thoughts = new Map<number, string>();
  for (const step of turn.reasoningSteps ?? []) {
    const text = step.thought?.trim();
    if (text) thoughts.set(step.iteration, text);
  }
  const callsByIteration = new Map<number, ChatToolCall[]>();
  for (const call of turn.toolCalls ?? []) {
    const key = call.iteration ?? Number.MAX_SAFE_INTEGER;
    callsByIteration.set(key, [...(callsByIteration.get(key) ?? []), call]);
  }
  const iterations = [...new Set([...thoughts.keys(), ...callsByIteration.keys()])].sort((a, b) => a - b);
  return iterations.flatMap((iteration): TimelineItem[] => [
    ...(thoughts.has(iteration) ? [{ kind: "thought" as const, iteration, text: thoughts.get(iteration)! }] : []),
    ...(callsByIteration.get(iteration) ?? []).map((call) => ({ kind: "tool" as const, call })),
  ]);
}

/** One step of a turn: a model turn's thinking plus the tools it called, in order. */
export interface TimelineStep {
  /** 1-based position in the turn. */
  readonly n: number;
  /** Stable key (`i<iteration>`, or `i?` for calls with no known iteration). */
  readonly key: string;
  readonly thought: string | undefined;
  readonly calls: readonly ChatToolCall[];
  /** `running` while any call runs; `failed` when any call failed; else `done`. */
  readonly status: "running" | "failed" | "done";
  /** Sum of the calls' reported durations, when any reported one. */
  readonly durationMs: number | undefined;
  /** One-line summary for the collapsed row: the thought's first sentence, else what was called. */
  readonly summary: string;
  /** Tool names with call counts, in first-call order (e.g. web-search ×4). */
  readonly tools: readonly { readonly name: string; readonly count: number }[];
  readonly failedCount: number;
}

const firstSentence = (text: string, max = 110): string => {
  const line = text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end > 0 ? line.slice(0, end + 1) : line;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
};

/** Group a turn's timeline into steps (one per model turn), for the step view. */
export function buildSteps(turn: Pick<ChatTurn, "reasoningSteps" | "toolCalls">): TimelineStep[] {
  const groups: { key: string; thought: string | undefined; calls: ChatToolCall[] }[] = [];
  for (const item of buildTimeline(turn)) {
    const iteration = item.kind === "thought" ? item.iteration : item.call.iteration;
    const key = iteration === undefined ? "i?" : `i${iteration}`;
    let g = groups[groups.length - 1];
    if (g === undefined || g.key !== key) {
      g = { key, thought: undefined, calls: [] };
      groups.push(g);
    }
    if (item.kind === "thought") g.thought = item.text;
    else g.calls.push(item.call);
  }
  return groups.map((g, i): TimelineStep => {
    const tools: { name: string; count: number }[] = [];
    for (const c of g.calls) {
      const t = tools.find((x) => x.name === c.name);
      if (t) t.count++;
      else tools.push({ name: c.name, count: 1 });
    }
    const durations = g.calls.map((c) => c.durationMs).filter((d): d is number => typeof d === "number");
    const failedCount = g.calls.filter((c) => c.status === "failed").length;
    return {
      n: i + 1,
      key: g.key,
      thought: g.thought,
      calls: g.calls,
      status: g.calls.some((c) => c.status === "running") ? "running" : failedCount > 0 ? "failed" : "done",
      durationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : undefined,
      summary: g.thought !== undefined
        ? firstSentence(g.thought)
        : `Called ${tools.map((t) => (t.count > 1 ? `${t.name} ×${t.count}` : t.name)).join(", ")}`,
      tools,
      failedCount,
    };
  });
}

/** Compact one-line preview of tool arguments for the collapsed card header. */
export function previewArgs(args: unknown, max = 80): string {
  if (args === undefined || args === null) return "";
  const text = typeof args === "string" ? args : JSON.stringify(args);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
