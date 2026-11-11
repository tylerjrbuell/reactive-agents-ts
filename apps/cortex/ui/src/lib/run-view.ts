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
 * The run's title: its label (run name or saved agent; a bare ULID does not
 * count), else the chat it came from, else the first line of its task (80
 * characters at most), else `Run <first 8 of the id>`. Never empty.
 */
export function runTitleOf(input: {
  readonly displayName?: string;
  readonly chatSessionName?: string;
  readonly task?: string;
  readonly runId: string;
}): string {
  const name = input.displayName?.trim();
  if (name && !isIdLike(name)) return name;
  const chat = input.chatSessionName?.trim();
  if (chat) return chat;
  const task = input.task ? firstLine(input.task) : "";
  if (task) return clip(task, 80);
  return `Run ${input.runId.slice(0, 8)}`;
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

/** Kernel loops recorded for replay: one per `ReasoningIterationProgress`. */
export function replayLoopCount(events: readonly RunViewEvent[]): number {
  let n = 0;
  for (const e of events) if (e.type === "ReasoningIterationProgress") n++;
  return n;
}

/**
 * The events a replay at kernel loop `loop` (1-based) shows: everything up to
 * and including the `loop`-th `ReasoningIterationProgress`. A loop past the
 * last boundary (or below 1) shows every event.
 */
export function replaySlice<T extends RunViewEvent>(events: readonly T[], loop: number): T[] {
  if (loop >= 1) {
    let seen = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i]!.type !== "ReasoningIterationProgress") continue;
      seen++;
      if (seen === loop) return events.slice(0, i + 1);
    }
  }
  return [...events];
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
export type InspectorTabId = "summary" | "decisions" | "signal" | "context" | "memory" | "messages" | "events";

/** One inspector tab: id, label and an optional count. */
export interface InspectorTab {
  readonly id: InspectorTabId;
  readonly label: string;
  readonly count?: number;
}

/**
 * The run inspector's tabs, in order: Summary, Decisions, Signal, Context,
 * Memory, Messages (with the message count) and Events (with the event count).
 * There is no Chat tab: a run continues in a chat session instead (owner
 * decision 5, `run-to-chat-session.ts`).
 */
export function inspectorTabsOf(counts: { readonly messages: number; readonly events: number }): readonly InspectorTab[] {
  return [
    { id: "summary", label: "Summary" },
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
