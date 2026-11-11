import {
  buildTurnSteps,
  buildTurnTranscript,
  summarizeTurn,
  type TranscriptSegment,
  type StepIterationText,
  type TurnEnding,
  type TurnStep,
  type TurnSummary,
} from "@reactive-agents/ui-core";
import type { ChatToolCall, ChatTurn } from "./chat-store.js";
import { chatTurnOutcome } from "../turn-ending.js";

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

type StepTurn = Pick<ChatTurn, "reasoningSteps" | "toolCalls" | "content" | "streaming">;

/**
 * The turn's action-first steps (ui-core `buildTurnSteps`): titled by the tools
 * called with retries grouped, narration and thinking apart, repeats collapsed,
 * failures linked to the call that fixed them. Steps persisted before narration
 * and thinking were split carry only `thought`, read as narration.
 */
export function turnSteps(turn: StepTurn): TurnStep<ChatToolCall>[] {
  const iterations = (turn.reasoningSteps ?? []).map((r): StepIterationText => {
    const split = r.narration !== undefined || r.thinking !== undefined;
    const narration = split ? r.narration : r.thought;
    return {
      iteration: r.iteration,
      ...(narration ? { narration } : {}),
      ...(r.thinking ? { thinking: r.thinking } : {}),
    };
  });
  return buildTurnSteps({
    iterations,
    calls: turn.toolCalls ?? [],
    ...(turn.streaming !== true && turn.content ? { answer: turn.content } : {}),
  });
}

/**
 * The turn as the agent talking (ui-core `buildTurnTranscript`): the model's
 * prose between iterations, the tool work between prose collapsed into groups
 * carrying their steps, then the answer. While streaming, a known answer is
 * final and the text of the iteration in flight is a non-final preview.
 * Thinking stays on the groups' steps, never in the reading path.
 */
export function turnTranscript(
  turn: StepTurn & Pick<ChatTurn, "liveText" | "runFailed" | "deliverables">,
  steps: readonly TurnStep<ChatToolCall>[] = turnSteps(turn),
): TranscriptSegment<ChatToolCall>[] {
  // The closing `ending` segment (and a partial run's draft as the answer) comes from the outcome.
  const outcome = turn.streaming === true ? undefined : chatTurnOutcome(turn);
  return buildTurnTranscript(steps, {
    answer: turn.content,
    pending: turn.streaming === true ? turn.liveText : undefined,
    outcome,
  });
}

/** How a finished turn ended, for the summary line; `undefined` while it streams. */
export function turnEnding(
  turn: Pick<ChatTurn, "streaming" | "cancelled" | "runFailed" | "incomplete">,
): TurnEnding | undefined {
  if (turn.streaming === true) return undefined;
  if (turn.cancelled) return "cancelled";
  if (turn.runFailed) return turn.runFailed.ending ?? "failed";
  if (turn.incomplete) return "errored";
  return "succeeded";
}

/** The turn's summary line: steps, calls, failures, outcome and the context window in use. */
export function turnSummary(
  turn: StepTurn & Pick<ChatTurn, "cancelled" | "runFailed" | "incomplete" | "context">,
  steps: readonly TurnStep[] = turnSteps(turn),
): TurnSummary {
  const ended = turnEnding(turn);
  const window = turn.context?.windowTokens;
  return summarizeTurn(steps, {
    ...(ended ? { ended } : {}),
    ...(turn.context && window
      ? { context: { tokensUsed: turn.context.tokensUsed, peakTokens: turn.context.tokensUsed, windowTokens: window } }
      : {}),
  });
}

/** Compact one-line preview of tool arguments for the collapsed card header. */
export function previewArgs(args: unknown, max = 80): string {
  if (args === undefined || args === null) return "";
  const text = typeof args === "string" ? args : JSON.stringify(args);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
