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

/** Compact one-line preview of tool arguments for the collapsed card header. */
export function previewArgs(args: unknown, max = 80): string {
  if (args === undefined || args === null) return "";
  const text = typeof args === "string" ? args : JSON.stringify(args);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
