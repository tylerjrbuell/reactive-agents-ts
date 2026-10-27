import type { UiStreamEvent } from "../protocol/events.js";

/**
 * Per-turn transcript fold: the ONE place that decides what counts as the
 * model's thinking vs. its answer vs. a tool call, shared by the live chat UI
 * and by servers that persist a turn so it can be re-inspected after a reload.
 *
 * Rules: text streamed before a tool call — or left over when the next
 * iteration starts — is that iteration's thinking. Text of the last iteration
 * stays `pending` (it is the answer, never a thought).
 */

/** One tool invocation within a turn. */
export interface TraceToolCall {
  readonly id: string;
  readonly name: string;
  readonly status: "running" | "done" | "failed";
  /** Iteration the call belongs to — orders it after that iteration's thinking. */
  readonly iteration: number;
  readonly durationMs?: number;
  readonly args?: unknown;
  readonly result?: string;
  readonly error?: string;
  readonly resultTruncated?: boolean;
}

export interface TurnTraceState {
  readonly iteration: number;
  readonly maxIterations: number;
  /** Text streamed in the current iteration, not yet classified (the live answer preview). */
  readonly pending: string;
  /** Pre-tool prose per iteration (the model "thinking aloud"; may restate the answer). */
  readonly thoughts: Readonly<Record<number, string>>;
  /** The provider's own reasoning per iteration (thinking models). Never a restatement of the answer. */
  readonly thinking: Readonly<Record<number, string>>;
  /** Calls in start order. */
  readonly calls: readonly TraceToolCall[];
  /** Authoritative final answer once `StreamCompleted` arrives. */
  readonly answer?: string;
}

/** The persistable shape of a finished turn's trace. */
export interface TurnTrace {
  readonly reasoningSteps: readonly { readonly iteration: number; readonly thought: string }[];
  readonly toolCalls: readonly TraceToolCall[];
}

export const initialTurnTrace = (): TurnTraceState => ({
  iteration: 1,
  maxIterations: 0,
  pending: "",
  thoughts: {},
  thinking: {},
  calls: [],
});

/** Merge a re-emitted thought into the accumulated one without duplicating it. */
export function mergeThoughtText(previous: string | undefined, incoming: string): string {
  const prev = (previous ?? "").trim();
  const next = incoming.trim();
  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev) || prev === next) return next;
  if (prev.endsWith(next)) return prev;
  return `${prev}\n${next}`;
}

const withThought = (s: TurnTraceState, iteration: number, text: string): TurnTraceState =>
  text.trim().length === 0
    ? s
    : { ...s, thoughts: { ...s.thoughts, [iteration]: mergeThoughtText(s.thoughts[iteration], text) } };

/** Classify the pending text as thinking of the current iteration. */
const foldPending = (s: TurnTraceState): TurnTraceState => ({ ...withThought(s, s.iteration, s.pending), pending: "" });

/** Fold one stream event into the trace. Events that don't affect the transcript return `s` unchanged. */
export function foldTurnTrace(s: TurnTraceState, event: UiStreamEvent): TurnTraceState {
  switch (event._tag) {
    case "TextDelta":
      return { ...s, pending: s.pending + event.text };
    case "IterationProgress": {
      const next = event.iteration > s.iteration ? foldPending(s) : s;
      return { ...next, iteration: event.iteration, maxIterations: event.maxIterations };
    }
    case "ThoughtEmitted":
      return withThought(s, event.iteration, event.content);
    case "ThinkingEmitted": {
      const text = event.content.trim();
      if (text.length === 0) return s;
      const prev = s.thinking[event.iteration];
      return { ...s, thinking: { ...s.thinking, [event.iteration]: prev ? `${prev}\n${text}` : text } };
    }
    case "ToolCallStarted": {
      const folded = foldPending(s);
      if (folded.calls.some((c) => c.id === event.callId)) return folded;
      const call: TraceToolCall = { id: event.callId, name: event.toolName, status: "running", iteration: folded.iteration };
      return { ...folded, calls: [...folded.calls, call] };
    }
    case "ToolCallCompleted": {
      const detail = {
        status: event.success ? ("done" as const) : ("failed" as const),
        ...(event.durationMs > 0 ? { durationMs: event.durationMs } : {}),
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.error !== undefined ? { error: event.error } : {}),
        ...(event.resultTruncated ? { resultTruncated: true } : {}),
      };
      const known = s.calls.some((c) => c.id === event.callId);
      return {
        ...s,
        calls: known
          ? s.calls.map((c) => (c.id === event.callId ? { ...c, ...detail } : c))
          : [...s.calls, { id: event.callId, name: event.toolName, iteration: s.iteration, ...detail }],
      };
    }
    case "StreamCompleted":
      return { ...s, answer: event.output };
    default:
      return s;
  }
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Thinking worth showing. Providers re-emit the answer text as a "thought" for
 * the final iterations (and repeat it per iteration), so a raw thought is
 * dropped when it merely restates the live answer preview, the final answer, or
 * an earlier iteration's thought — otherwise the same block renders 2-3 times.
 */
export function visibleThoughts(s: TurnTraceState): Readonly<Record<number, string>> {
  const answers = [s.answer, s.pending].map((a) => normalize(a ?? "")).filter((a) => a.length > 0);
  const seen = new Set<string>();
  const prose: Record<number, string> = {};
  for (const iteration of Object.keys(s.thoughts).map(Number).sort((a, b) => a - b)) {
    const thought = s.thoughts[iteration]!;
    const n = normalize(thought);
    if (n.length === 0 || seen.has(n)) continue;
    if (answers.some((a) => a === n || (n.length > 40 && a.includes(n)))) continue;
    seen.add(n);
    prose[iteration] = thought;
  }
  // Provider reasoning is genuine thinking: always shown, ahead of any pre-tool prose.
  const out: Record<number, string> = {};
  for (const iteration of new Set([...Object.keys(s.thinking), ...Object.keys(prose)].map(Number))) {
    out[iteration] = [s.thinking[iteration], prose[iteration]].filter((t): t is string => !!t).join("\n\n");
  }
  return out;
}

/**
 * The trace to persist, or `undefined` when the turn had neither thinking nor
 * tool calls. `resultCap` bounds each stored result/error (flagging
 * `resultTruncated`), keeping a long chat's rows small.
 */
export function finishTurnTrace(s: TurnTraceState, opts: { readonly resultCap?: number } = {}): TurnTrace | undefined {
  const cap = opts.resultCap ?? Number.POSITIVE_INFINITY;
  const clip = (text: string | undefined): { text?: string; cut: boolean } =>
    text === undefined ? { cut: false } : text.length > cap ? { text: text.slice(0, cap), cut: true } : { text, cut: false };
  const toolCalls = s.calls.map((c): TraceToolCall => {
    const r = clip(c.result);
    const e = clip(c.error);
    return {
      ...c,
      status: c.status === "running" ? "done" : c.status,
      ...(r.text !== undefined ? { result: r.text } : {}),
      ...(e.text !== undefined ? { error: e.text } : {}),
      ...(r.cut || e.cut ? { resultTruncated: true } : {}),
    };
  });
  const reasoningSteps = Object.entries(visibleThoughts(s))
    .map(([iteration, thought]) => ({ iteration: Number(iteration), thought }))
    .sort((a, b) => a.iteration - b.iteration);
  return toolCalls.length === 0 && reasoningSteps.length === 0 ? undefined : { reasoningSteps, toolCalls };
}
