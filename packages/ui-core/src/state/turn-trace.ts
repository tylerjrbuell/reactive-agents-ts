import type { ChecklistSnapshotWire, ExitGateDecision, SubAgentRunInfoWire, UiStreamEvent } from "../protocol/events.js";
import { foldSubAgentActivity, type SubAgentFolder, type SubAgentTrace } from "./sub-agent-fold.js";
import { summarizeUsage, type TurnUsage } from "./token-usage.js";
import { turnOutcomeOf, type TurnEnding, type TurnOutcome } from "./turn-outcome.js";

export type { TurnEnding, TurnOutcome } from "./turn-outcome.js";

/**
 * Per-turn transcript fold: the ONE place that decides what counts as the
 * model's thinking vs. its answer vs. a tool call, shared by the live chat UI
 * and by servers that persist a turn so it can be re-inspected after a reload.
 *
 * Rules: text streamed before a tool call — or left over when the next
 * iteration starts — is that iteration's thinking. Text of the last iteration
 * stays `pending` (it is the answer, never a thought).
 *
 * Iteration attribution: the fold keeps its own cursor from `IterationProgress`
 * and files narration (`ThoughtEmitted`), provider thinking (`ThinkingEmitted`)
 * and tool calls under it. The events' own `iteration` field is not trusted:
 * the runtime fills `ThoughtEmitted.iteration` with the kernel's step index
 * (2, 6, 10, ...), not the iteration, which rendered phantom steps that repeated
 * earlier ones word for word. Before the first `IterationProgress` the cursor is
 * provisional; the first progress event re-keys what was filed under it.
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
  /** Latest checklist snapshot seen this turn (highest `lastSeq` wins). */
  readonly checklist?: ChecklistSnapshotWire;
  /** Latest non-accept exit-gate decision this turn (repair / handoff), when any. */
  readonly exitGate?: Omit<ExitGateDecision, "_tag">;
  /** Sub-agent blocks by stable key, in start order; each child's `trace` is folded by this same function. */
  readonly subAgents: Readonly<Record<string, SubAgentTrace>>;
  /** Per-LLM-call token usage evidence for this turn, absent until a call reports. */
  readonly usage?: TurnUsage;
  /** Context window in use: the latest `ContextPressure` reading plus the turn's peak. Absent until one arrives. */
  readonly context?: TurnContext;
  /** How the turn ended; absent while it is still running. */
  readonly ended?: TurnEnding;
  /** The detail behind `ended` (cause, abstention, unfinished items, deliverables), once `StreamCompleted` arrives. */
  readonly outcome?: TurnOutcome;
  /** The strategy the run reported (`StreamCompleted.metadata.strategyUsed`: the last one, after any switch). */
  readonly strategy?: string;
  /** How long the run took, as it reported (`StreamCompleted.metadata.duration`, ms). */
  readonly durationMs?: number;
  /** True once an `IterationProgress` fixed the cursor (before that, `iteration` is provisional). */
  readonly progressSeen?: true;
}

/** The context window the turn's model calls ran in. */
export interface TurnContext {
  /** Prompt tokens on the latest call. */
  readonly tokensUsed: number;
  /** Largest prompt seen this turn. */
  readonly peakTokens: number;
  /** Total window (used + remaining) on the latest call: the `num_ctx` / context size actually in use. */
  readonly windowTokens: number;
}

/** One iteration of a persisted trace. `thought` is the legacy combined text; new traces also split it. */
export interface PersistedReasoningStep {
  readonly iteration: number;
  /** Thinking followed by narration, as one block (kept for readers of older traces). */
  readonly thought: string;
  /** The model's visible prose this iteration (pre-tool narration). */
  readonly narration?: string;
  /** The provider's own reasoning this iteration (thinking models). */
  readonly thinking?: string;
}

/** The persistable shape of a finished sub-agent block (recursive). */
export interface PersistedSubAgent {
  readonly run: SubAgentRunInfoWire;
  readonly status: "done" | "failed";
  readonly trace: TurnTrace;
  readonly output?: string;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly startedAt: number;
  readonly endedAt?: number;
}

/** The persistable shape of a finished turn's trace. */
export interface TurnTrace {
  readonly reasoningSteps: readonly PersistedReasoningStep[];
  readonly toolCalls: readonly TraceToolCall[];
  /** Final checklist snapshot, present only when the turn produced one. */
  readonly checklist?: ChecklistSnapshotWire;
  /** Finished sub-agent blocks in start order, present only when the turn spawned any. */
  readonly subAgents?: readonly PersistedSubAgent[];
  /** Per-call token usage evidence, present only when at least one call reported. */
  readonly usage?: TurnUsage;
  /** Context window in use, present only when the run reported one. */
  readonly context?: TurnContext;
  /** How the run ended, present only when it did not simply succeed or it listed deliverables. */
  readonly outcome?: TurnOutcome;
  /** The strategy the run reported, when it reported one. */
  readonly strategy?: string;
  /** How long the run took (ms), when it reported. */
  readonly durationMs?: number;
}

/** An empty trace, before any event of the turn. */
export const initialTurnTrace = (): TurnTraceState => ({
  iteration: 1,
  maxIterations: 0,
  pending: "",
  thoughts: {},
  thinking: {},
  calls: [],
  subAgents: {},
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

/**
 * Drop from `pending` the text a `ThoughtEmitted` just classified. The kernel
 * streams a call's TextDelta, then emits its ThoughtEmitted(n), then
 * IterationProgress(n); without this, the same text was recorded under n by the
 * thought AND folded under n-1 as pending, so every thinking block repeated the
 * next one. Only a pending text that begins with the thought is consumed.
 */
const consumePending = (pending: string, thought: string): string => {
  const t = thought.trim();
  const p = pending.trimStart();
  if (t.length === 0 || !p.startsWith(t)) return pending;
  return p.slice(t.length);
};

/** Classify the pending text as thinking of the current iteration. */
const foldPending = (s: TurnTraceState): TurnTraceState => ({ ...withThought(s, s.iteration, s.pending), pending: "" });

const subAgentFolder: SubAgentFolder<TurnTraceState> = {
  init: initialTurnTrace,
  fold: (s, e) => foldTurnTrace(s, e),
  nested: (s) => s.subAgents,
  withNested: (s, subAgents) => ({ ...s, subAgents }),
};

/** Move every entry filed under `from` to `to` (merging text), for the first progress event. */
const rekeyIteration = (s: TurnTraceState, from: number, to: number): TurnTraceState => {
  if (from === to) return s;
  const move = (rec: Readonly<Record<number, string>>, join: (a: string | undefined, b: string) => string) => {
    const text = rec[from];
    if (text === undefined) return rec;
    const { [from]: _moved, ...rest } = rec;
    return { ...rest, [to]: join(rest[to], text) };
  };
  return {
    ...s,
    thoughts: move(s.thoughts, mergeThoughtText),
    thinking: move(s.thinking, (a, b) => (a ? `${a}\n${b}` : b)),
    calls: s.calls.map((c) => (c.iteration === from ? { ...c, iteration: to } : c)),
  };
};

/** Fold one stream event into the trace. Events that don't affect the transcript return `s` unchanged. */
export function foldTurnTrace(s: TurnTraceState, event: UiStreamEvent): TurnTraceState {
  switch (event._tag) {
    case "TextDelta":
      return { ...s, pending: s.pending + event.text };
    case "IterationProgress": {
      if (s.progressSeen !== true) {
        const anchored = rekeyIteration(s, s.iteration, event.iteration);
        return { ...anchored, iteration: event.iteration, maxIterations: event.maxIterations, progressSeen: true };
      }
      const next = event.iteration > s.iteration ? foldPending(s) : s;
      return { ...next, iteration: event.iteration, maxIterations: event.maxIterations };
    }
    case "ThoughtEmitted":
      // Filed under the fold's cursor: the event's `iteration` is the kernel step index (see header).
      return { ...withThought(s, s.iteration, event.content), pending: consumePending(s.pending, event.content) };
    case "ThinkingEmitted": {
      const text = event.content.trim();
      if (text.length === 0) return s;
      const prev = s.thinking[s.iteration];
      return { ...s, thinking: { ...s.thinking, [s.iteration]: prev ? `${prev}\n${text}` : text } };
    }
    case "ContextPressure": {
      const windowTokens = event.tokensUsed + event.tokensAvailable;
      if (!(windowTokens > 0)) return s;
      const peakTokens = Math.max(s.context?.peakTokens ?? 0, event.tokensUsed);
      return { ...s, context: { tokensUsed: event.tokensUsed, peakTokens, windowTokens } };
    }
    case "StreamError":
      return { ...s, ended: "errored" };
    case "StreamCancelled":
      return { ...s, ended: "cancelled" };
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
    case "ChecklistUpdated":
      return s.checklist !== undefined && event.checklist.lastSeq < s.checklist.lastSeq
        ? s
        : { ...s, checklist: event.checklist };
    case "ExitGateDecision":
      return { ...s, exitGate: { decision: event.decision, outstanding: event.outstanding, iteration: event.iteration } };
    case "SubAgentActivity":
      return { ...s, subAgents: foldSubAgentActivity(subAgentFolder, s.subAgents, event) };
    case "TokenUsage":
      return { ...s, usage: summarizeUsage(s.usage, event) };
    case "StreamCompleted": {
      const outcome = turnOutcomeOf(event);
      const strategy = event.metadata?.strategyUsed;
      const duration = event.metadata?.duration;
      return {
        ...s,
        answer: event.output,
        ended: outcome.ending,
        outcome,
        ...(typeof strategy === "string" && strategy.length > 0 ? { strategy } : {}),
        ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? { durationMs: duration } : {}),
      };
    }
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
  const out: Record<number, string> = {};
  for (const step of visibleIterations(s)) {
    out[step.iteration] = [step.thinking, step.narration].filter((t): t is string => !!t).join("\n\n");
  }
  return out;
}

/** One iteration's visible text, split: provider thinking and the model's narration. */
export interface VisibleIteration {
  readonly iteration: number;
  readonly narration?: string;
  readonly thinking?: string;
}

/**
 * {@link visibleThoughts} with narration and thinking kept apart, in iteration
 * order. Narration restating the answer (or an earlier iteration) is dropped;
 * provider thinking is always kept.
 */
export function visibleIterations(s: TurnTraceState): readonly VisibleIteration[] {
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
  return [...new Set([...Object.keys(s.thinking), ...Object.keys(prose)].map(Number))]
    .sort((a, b) => a - b)
    .map((iteration) => ({
      iteration,
      ...(prose[iteration] ? { narration: prose[iteration] } : {}),
      ...(s.thinking[iteration] ? { thinking: s.thinking[iteration] } : {}),
    }));
}

/**
 * The trace to persist, or `undefined` when the turn recorded nothing (no
 * thinking, calls, checklist, sub-agents, usage, non-plain outcome, reported
 * strategy or duration). `resultCap` bounds each stored result/error (flagging
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
  const reasoningSteps = visibleIterations(s).map((v): PersistedReasoningStep => ({
    iteration: v.iteration,
    thought: [v.thinking, v.narration].filter((t): t is string => !!t).join("\n\n"),
    ...(v.narration ? { narration: v.narration } : {}),
    ...(v.thinking ? { thinking: v.thinking } : {}),
  }));
  const subAgents = Object.values(s.subAgents).map((b): PersistedSubAgent => {
    const output = clip(b.output);
    return {
      run: b.run,
      // A child still running at turn end never reported completion: persist as failed, not done.
      status: b.status === "running" ? "failed" : b.status,
      trace: finishTurnTrace(b.trace, opts) ?? { reasoningSteps: [], toolCalls: [] },
      ...(output.text !== undefined ? { output: output.text } : {}),
      ...(b.tokens !== undefined ? { tokens: b.tokens } : {}),
      ...(b.costUsd !== undefined ? { costUsd: b.costUsd } : {}),
      startedAt: b.startedAt,
      ...(b.endedAt !== undefined ? { endedAt: b.endedAt } : {}),
    };
  });
  const outcome =
    s.outcome !== undefined && (s.outcome.ending !== "succeeded" || s.outcome.deliverables !== undefined) ? s.outcome : undefined;
  if (
    toolCalls.length === 0 &&
    reasoningSteps.length === 0 &&
    s.checklist === undefined &&
    subAgents.length === 0 &&
    s.usage === undefined &&
    outcome === undefined &&
    s.strategy === undefined &&
    s.durationMs === undefined
  ) return undefined;
  return {
    reasoningSteps,
    toolCalls,
    ...(s.checklist !== undefined ? { checklist: s.checklist } : {}),
    ...(subAgents.length > 0 ? { subAgents } : {}),
    ...(s.usage !== undefined ? { usage: s.usage } : {}),
    ...(s.context !== undefined ? { context: s.context } : {}),
    ...(outcome !== undefined ? { outcome } : {}),
    ...(s.strategy !== undefined ? { strategy: s.strategy } : {}),
    ...(s.durationMs !== undefined ? { durationMs: s.durationMs } : {}),
  };
}
