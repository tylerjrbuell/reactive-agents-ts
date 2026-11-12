/**
 * Pure rules for the run view (`RunDetail.svelte` and its `components/run/`
 * pieces, Bench spec section 8): the run's title, the replay slice, the
 * inspector tab list and the entropy series the Summary draws.
 */
import { statusOfRun, statusOfTurn, type StatusView, type TurnEnding } from "@reactive-agents/ui-core";
/** A run event as the run view holds it (`CortexLiveMsg`). */
export interface RunViewEvent {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

const firstLine = (s: string): string => s.trim().split("\n")[0]?.trim() ?? "";

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The runtime's chat-history marker (`withHistoryBlock`, packages/runtime `reactive-agent.ts`). */
const CURRENT_MESSAGE_MARKER = "--- Current message ---";

/**
 * A task's headline: the first line of what was asked, at most 80 characters.
 * A chat turn's task is the history block followed by `--- Current message ---`
 * and the message; the headline is the message, never `--- Conversation
 * history ---`. Empty when the task has no text.
 */
export function taskHeadline(task: string): string {
  const at = task.lastIndexOf(CURRENT_MESSAGE_MARKER);
  const asked = at >= 0 ? task.slice(at + CURRENT_MESSAGE_MARKER.length) : task;
  return clip(firstLine(asked), 80);
}

/**
 * The task the run was given: the first `AgentStarted.task` (GH #236), else
 * `undefined` (older emitters do not stamp it).
 */
export function runTaskOf(events: readonly RunViewEvent[]): string | undefined {
  for (const e of events) {
    if (e.type !== "AgentStarted") continue;
    const task = e.payload.task;
    if (typeof task === "string" && task.trim() !== "") return task.trim();
  }
  return undefined;
}

/** A ULID (26 Crockford base-32 characters): a chat agent's id stored as a run label is not a name. */
export function isIdLike(s: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s.trim());
}

/**
 * A run id short enough to read and long enough to tell runs apart: the first
 * 12 characters (the run header's breadcrumb shows the same). A ULID's first 10
 * characters are its millisecond timestamp, so 8 collide for runs started in
 * the same second.
 */
export function shortRunId(runId: string): string {
  return runId.slice(0, 12);
}

/**
 * The run's title: its label (run name or saved agent; a bare ULID or a label
 * equal to the agent id does not count, the same rule as `runNameOf`), else
 * the chat it came from, else the first line of its task (80 characters at
 * most), else `Run <shortRunId>`. Never empty.
 */
export function runTitleOf(input: {
  readonly displayName?: string;
  readonly chatSessionName?: string;
  readonly task?: string;
  readonly runId: string;
  /** The run's agent id: a label equal to it is not a name. */
  readonly agentId?: string;
}): string {
  const name = input.displayName?.trim();
  if (name && !isIdLike(name) && name !== input.agentId?.trim()) return name;
  const chat = input.chatSessionName?.trim();
  if (chat) return chat;
  const task = input.task ? taskHeadline(input.task) : "";
  if (task) return task;
  return `Run ${shortRunId(input.runId)}`;
}

/**
 * The status the run header shows: the shared run vocabulary (`statusOfRun`),
 * except that a run that ended without success says how (`partial`,
 * `abstained`: attention, not a red failure) through `statusOfTurn`, and a run
 * still loading reads idle.
 */
export function runHeaderStatus(status: string, ending: TurnEnding | undefined): StatusView {
  if (status === "loading") return { tone: "idle", label: "Loading" };
  if (status === "failed" && (ending === "partial" || ending === "abstained")) return statusOfTurn(ending);
  return statusOfRun(status);
}

/**
 * Index of the last `ReasoningIterationProgress` of each recorded loop. The
 * kernel can report one iteration twice in a row (same `iteration`); the pair
 * is one loop, the same rule the trace store folds rows by.
 */
function loopEnds(events: readonly RunViewEvent[]): number[] {
  const ends: number[] = [];
  let last: unknown = Symbol("none");
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== "ReasoningIterationProgress") continue;
    const it = typeof e.payload.iteration === "number" ? e.payload.iteration : Symbol("unnumbered");
    if (it === last) ends[ends.length - 1] = i;
    else ends.push(i);
    last = it;
  }
  return ends;
}

/** Kernel loops recorded for replay: one per reported iteration (`ReasoningIterationProgress`). */
export function replayLoopCount(events: readonly RunViewEvent[]): number {
  return loopEnds(events).length;
}

/**
 * The events a replay at kernel loop `loop` (1-based) shows: everything up to
 * and including that loop's last `ReasoningIterationProgress`. A loop past the
 * last boundary (or below 1) shows every event.
 */
export function replaySlice<T extends RunViewEvent>(events: readonly T[], loop: number): T[] {
  const end = loop >= 1 ? loopEnds(events)[loop - 1] : undefined;
  return end === undefined ? [...events] : events.slice(0, end + 1);
}

/**
 * The vitals loop label. `reported` is the framework's loop count
 * (`AgentCompleted.totalIterations` / the last `ReasoningIterationProgress`),
 * `recorded` the loop rows the trace holds (one per stored
 * `ReasoningIterationProgress`). They can differ (a Reflexion pass counts as a
 * loop but records no row), so the label names both rather than read as a
 * contradiction of the trace's Loops count: `Loops 2 of 3 · 1 traced`.
 */
export function loopsVitalLabel(reported: number, max: number, recorded: number, replay?: { readonly loop: number; readonly max: number }): string {
  if (replay) return `Replay ${replay.loop} of ${replay.max}`;
  if (reported <= 0) return recorded > 0 ? `Loops ${recorded}` : "Loops";
  const base = max > 0 && reported <= max ? `Loops ${reported} of ${max}` : `Loops ${reported}`;
  return recorded > 0 && recorded !== reported ? `${base} · ${recorded} traced` : base;
}

/** `1 loop`, `3 loops`: the count the Replay control names. */
export function loopsLabel(n: number): string {
  return `${n} loop${n === 1 ? "" : "s"}`;
}

/** One inspector tab id (spec section 8, Run view). */
export type InspectorTabId = "summary" | "safety" | "judgments" | "decisions" | "signal" | "context" | "memory" | "messages" | "events";

/** One inspector tab: id, label and an optional count. */
export interface InspectorTab {
  readonly id: InspectorTabId;
  readonly label: string;
  readonly count?: number;
}

/**
 * The run inspector's tabs, in order: Summary, Safety (with the count of
 * safety events that fired, ui-core `safetySummaryOf`), Judgments (with the
 * ledger's row count, ui-core `foldJudgments`), Decisions, Signal,
 * Context, Memory, Messages (with the message count) and Events (with the
 * event count). There is no Chat tab: a run continues in a chat session
 * instead (owner decision 5, `run-to-chat-session.ts`).
 */
export function inspectorTabsOf(counts: { readonly messages: number; readonly events: number; readonly safety?: number; readonly judgments?: number }): readonly InspectorTab[] {
  return [
    { id: "summary", label: "Summary" },
    { id: "safety", label: "Safety", ...((counts.safety ?? 0) > 0 ? { count: counts.safety } : {}) },
    { id: "judgments", label: "Judgments", ...((counts.judgments ?? 0) > 0 ? { count: counts.judgments } : {}) },
    { id: "decisions", label: "Decisions" },
    { id: "signal", label: "Signal" },
    { id: "context", label: "Context" },
    { id: "memory", label: "Memory" },
    { id: "messages", label: "Messages", ...(counts.messages > 0 ? { count: counts.messages } : {}) },
    { id: "events", label: "Events", ...(counts.events > 0 ? { count: counts.events } : {}) },
  ];
}

/**
 * The entropy series the Summary and the vitals draw: one value per
 * `EntropyScored` sample, in order. A single sample is a series too (spec
 * B7: the Summary said "no entropy data" while the vitals showed η from that
 * one sample); only zero samples is empty.
 */
export function entropySeriesOf(points: readonly { readonly value: number }[]): readonly number[] {
  return points.map((p) => p.value).filter((v) => Number.isFinite(v));
}

/** The run vitals' entropy trajectory (`RunVitals.trajectory`). */
export type EntropyTrajectory = "CONVERGING" | "EXPLORING" | "STRESSED" | "DIVERGING";

/**
 * The trajectory as a sentence-case word and a badge tone (no uppercase
 * labels, spec section 6): converging is `settling` (neutral), exploring is
 * `exploring` (neutral), stressed and diverging read as a warning.
 */
export function trajectoryView(t: EntropyTrajectory): { readonly label: string; readonly tone: "neutral" | "warn" } {
  switch (t) {
    case "CONVERGING":
      return { label: "settling", tone: "neutral" };
    case "STRESSED":
      return { label: "stressed", tone: "warn" };
    case "DIVERGING":
      return { label: "diverging", tone: "warn" };
    default:
      return { label: "exploring", tone: "neutral" };
  }
}

/**
 * The run produced an answer and a guardrail then withheld it: a blocking
 * `GuardrailViolationDetected` after the last `FinalAnswerProduced` (the
 * runtime's output screen). The framework publishes `FinalAnswerProduced`
 * before that screen runs, so the run view must not show the text as the
 * run's answer (or seed a chat with it); the trace still shows what the model
 * wrote. An input block comes before any answer and does not count.
 */
export function answerWithheld(events: readonly RunViewEvent[]): boolean {
  let answered = false;
  let withheld = false;
  for (const e of events) {
    if (e.type === "FinalAnswerProduced") {
      answered = true;
      withheld = false;
    } else if (answered && e.type === "GuardrailViolationDetected" && e.payload.blocked === true) {
      withheld = true;
    }
  }
  return withheld;
}
