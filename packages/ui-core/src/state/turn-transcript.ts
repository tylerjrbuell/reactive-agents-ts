import type { TurnOutcome } from "./turn-outcome.js";
import { splitReasoning } from "./reasoning-split.js";
import { buildTurnSteps, persistedTurnStepsOf, type StepCall, type TurnStep } from "./turn-steps.js";
import { visibleIterations, type TraceToolCall, type TurnTrace, type TurnTraceState } from "./turn-trace.js";

/**
 * Chat-transcript view of one agent turn: the turn read as the agent talking.
 * The model's prose between iterations is message text, the tool work between
 * two pieces of prose collapses into one group ("Ran 4 tools · 1 failed"), and
 * the final answer closes the turn. Provider thinking leads as a collapsible
 * segment, never as message text, and stays on the steps a tool group carries.
 *
 * Built on {@link buildTurnSteps}: a tool group holds the action-first steps it
 * covers, so a UI expands a group into the same step rows it shows elsewhere.
 * Pure and live-safe: call it on every event of a streaming turn.
 */

/** Model prose shown to the user as message text. */
export interface TranscriptProse {
  readonly kind: "prose";
  /** Stable key (`p` + the step key). */
  readonly key: string;
  readonly text: string;
  /** First iteration of the step the prose belongs to. */
  readonly iteration: number;
  /** 1-based number of that step in the turn's {@link TurnStep} list. */
  readonly step: number;
}

/** Consecutive tool work between two pieces of prose, collapsed to one line. */
export interface TranscriptTools<C extends StepCall = StepCall> {
  readonly kind: "tools";
  /** Stable key (`t` + the first step's key). */
  readonly key: string;
  /** The steps this group covers, for the expanded view. */
  readonly steps: readonly TurnStep<C>[];
  /** Every call in the group, in start order. */
  readonly calls: readonly C[];
  /** Distinct tool display names (MCP prefix removed), in first-call order. */
  readonly tools: readonly string[];
  /** Calls that failed. */
  readonly failed: number;
  /** Of those, failures a later call of the same tool fixed (in this turn). */
  readonly fixed: number;
  /** True while a call in the group runs. */
  readonly running: boolean;
  /** Sum of reported call durations, when any reported. */
  readonly durationMs?: number;
  /** `Ran 4 tools · 1 failed`, or `Running get_website_metrics` while a call runs. */
  readonly label: string;
}

/**
 * The turn's answer. `final` is false for the live preview: text still
 * streaming may yet turn out to be narration before a tool call.
 */
export interface TranscriptAnswer {
  readonly kind: "answer";
  readonly key: "answer";
  readonly text: string;
  readonly final: boolean;
}

/**
 * How the turn ended, after the answer. Present when the run did not simply
 * succeed (partial, failed, abstained, paused), or when it succeeded with no
 * answer text and listed its deliverables (the files are then the answer).
 * Render each ending as its own state: an abstention is a decline with a
 * reason, not a crash.
 */
export interface TranscriptEnding {
  readonly kind: "ending";
  readonly key: "ending";
  readonly outcome: TurnOutcome;
}

/**
 * The turn's reasoning, to be drawn as a collapsible "Thinking" pill: the provider's thinking
 * (`ThinkingEmitted`) plus any reasoning a model printed into its visible text
 * ({@link splitReasoning}). Always the first segment. `live` while the turn still streams, so a
 * view can show the text growing (muted) and collapse it when the turn ends.
 */
export interface TranscriptThinking {
  readonly kind: "thinking";
  readonly key: "thinking";
  readonly text: string;
  readonly live: boolean;
}

/** One segment of a turn transcript, in reading order. */
export type TranscriptSegment<C extends StepCall = StepCall> =
  | TranscriptThinking
  | TranscriptProse
  | TranscriptTools<C>
  | TranscriptAnswer
  | TranscriptEnding;

const norm = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const toolsSegment = <C extends StepCall>(steps: readonly TurnStep<C>[]): TranscriptTools<C> => {
  const calls = steps.flatMap((s) => s.calls);
  const failures = steps.flatMap((s) => s.failures);
  const fixed = failures.filter((f) => f.fixedBy !== undefined).length;
  const tools = [...new Set(steps.flatMap((s) => s.actions.map((a) => a.shortName)))];
  const runningNames = [
    ...new Set(steps.flatMap((s) => s.actions.filter((a) => a.calls.some((c) => c.status === "running")).map((a) => a.shortName))),
  ];
  const durations = steps.map((s) => s.durationMs).filter((d): d is number => typeof d === "number");
  const label =
    runningNames.length > 0
      ? `Running ${runningNames.join(", ")}`
      : [
          `Ran ${plural(calls.length, "tool")}`,
          failures.length > 0 ? `${failures.length} failed${fixed > 0 ? `, ${fixed} fixed` : ""}` : undefined,
        ]
          .filter((p): p is string => p !== undefined)
          .join(" · ");
  return {
    kind: "tools",
    key: `t${steps[0]!.key}`,
    steps,
    calls,
    tools,
    failed: failures.length,
    fixed,
    running: runningNames.length > 0,
    ...(durations.length > 0 ? { durationMs: durations.reduce((a, b) => a + b, 0) } : {}),
    label,
  };
};

/**
 * Project a turn's steps into reading order: per step, its narration (as
 * prose), then its tool calls; consecutive tool work with no prose between
 * merges into one group; the answer closes the transcript.
 *
 * - Thinking leads the transcript as one `thinking` segment (a collapsible pill); it also stays on
 *   the group's steps for drill-down.
 * - Prose equal to the answer, contained in a long answer, or repeating
 *   earlier prose is dropped, so the answer never renders twice.
 * - `answer` (final) wins over `pending` (the live preview, `final: false`).
 * - With an `outcome`, a partial run's answer is its draft (the `Unfinished:`
 *   list moves to the closing `ending` segment), and an `ending` segment closes
 *   the transcript when the run did not simply succeed.
 */
export function buildTurnTranscript<C extends StepCall>(
  steps: readonly TurnStep<C>[],
  opts: {
    readonly answer?: string | undefined;
    readonly pending?: string | undefined;
    readonly outcome?: TurnOutcome | undefined;
    /** The turn still streams: its thinking segment is `live`. */
    readonly live?: boolean | undefined;
  } = {},
): TranscriptSegment<C>[] {
  const outcome = opts.outcome;
  const finalText = outcome?.ending === "partial" && outcome.draft !== undefined ? outcome.draft : opts.answer;
  // Reasoning a model printed into its visible text moves to the thinking segment (one rule: splitReasoning),
  // confirmed against what the run reported on its own channels.
  const channels = steps.flatMap((s) => [s.thinking, s.narration]);
  const finalSplit = finalText?.trim() ? splitReasoning(finalText, channels) : undefined;
  const answerText = finalSplit?.answer.trim() ? finalSplit.answer : undefined;
  const pendingSplit = answerText === undefined && !finalSplit && opts.pending?.trim() ? splitReasoning(opts.pending, channels, { live: true }) : undefined;
  const pendingText = pendingSplit?.answer.trim() ? pendingSplit.answer : undefined;
  const thinkingText = [...steps.map((s) => s.thinking), finalSplit?.reasoning, pendingSplit?.reasoning]
    .filter((t): t is string => !!t && t.trim().length > 0)
    .join("\n\n");
  const closing = norm(answerText ?? pendingText);
  const restatesAnswer = (n: string): boolean =>
    closing.length > 0 && (n === closing || (n.length > 40 && closing.includes(n)));

  const out: TranscriptSegment<C>[] = [];
  if (thinkingText.length > 0) out.push({ kind: "thinking", key: "thinking", text: thinkingText, live: opts.live === true });
  const seen = new Set<string>();
  let run: TurnStep<C>[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push(toolsSegment(run));
    run = [];
  };
  for (const step of steps) {
    const n = norm(step.narration);
    if (n.length > 0 && !seen.has(n) && !restatesAnswer(n)) {
      seen.add(n);
      flush();
      out.push({ kind: "prose", key: `p${step.key}`, text: step.narration!.trim(), iteration: step.iterations[0] ?? 0, step: step.n });
    }
    if (step.calls.length > 0) run.push(step);
  }
  flush();
  if (answerText !== undefined) out.push({ kind: "answer", key: "answer", text: answerText, final: true });
  else if (pendingText !== undefined) out.push({ kind: "answer", key: "answer", text: pendingText, final: false });
  if (outcome !== undefined && endingShown(outcome, answerText !== undefined)) out.push({ kind: "ending", key: "ending", outcome });
  return out;
}

/** An ending worth its own segment: anything but a plain success, or a success whose files are the answer. */
const endingShown = (o: TurnOutcome, hasAnswer: boolean): boolean =>
  o.ending !== "succeeded" || (!hasAnswer && (o.deliverables?.some((d) => d.produced) ?? false));

/**
 * Transcript of a live (or just finished) turn, straight from the fold. While
 * the turn streams, the text of the iteration in flight is the non-final answer.
 */
export function turnTranscriptOf(s: TurnTraceState): TranscriptSegment<TraceToolCall>[] {
  const steps = buildTurnSteps({ iterations: visibleIterations(s), calls: s.calls, ...(s.answer ? { answer: s.answer } : {}) });
  return buildTurnTranscript(steps, { answer: s.answer, pending: s.pending, outcome: s.outcome, live: s.ended === undefined });
}

/**
 * Transcript of a persisted turn. Traces written before narration was split
 * out carry only `thought`, read as narration; a trace with no text at all
 * reads as one tool group and the answer.
 */
export function persistedTurnTranscriptOf(t: TurnTrace, answer?: string): TranscriptSegment<TraceToolCall>[] {
  return buildTurnTranscript(persistedTurnStepsOf(t, answer), { answer, outcome: t.outcome });
}
