/**
 * How an interrupted run is worded (Cortex chat and Runs). The framework records every
 * run that did not complete as a durable row with a status and, once it ended, a stop
 * record (`kind`, reason, what was done, what is unfinished); `agent.resumeRun` continues
 * any of them. Cortex only renders that record: this module owns the chip labels, the
 * plain-words headline per kind and the facts list. It decides nothing about whether a
 * run can continue (the server lists only runs the framework flags resumable).
 * Rendering: `components/ContinueStopped.svelte`, `components/RunStatusChip.svelte`.
 */
import type { StatusTone } from "@reactive-agents/ui-core";

/** Why a durable run did not complete (the framework's `RunStopKind`). */
export type RunStopKind = "user-paused" | "user-stopped" | "error" | "crash" | "loop" | "budget" | "timeout";

/** The durable run row statuses (the framework's `RunStoreStatus`). */
export type DurableRunStatus = "running" | "paused" | "stopped" | "failed" | "completed" | "awaiting-approval" | "awaiting-interaction";

/** Why a run stopped and what it had already done (the framework's `RunStopSummary`). */
export interface StopWire {
  /** Absent on a row from before kinds existed: a loop stop. */
  readonly kind?: RunStopKind;
  readonly reason: string;
  /** The tool the run kept repeating, when the trailing actions repeat one call. */
  readonly repeatedTool?: string;
  /** Tools that already returned substantive results (not re-run on Continue), with call counts. */
  readonly toolsDone: readonly { readonly tool: string; readonly calls: number }[];
  /** Titles of checklist rows still open at the stop. */
  readonly unfinished: readonly string[];
  /** The iteration the run stopped at. */
  readonly iteration: number;
}

/** A status chip: the label always says the state, the tone is the shared `Status` vocabulary. */
export interface ChipView {
  readonly label: string;
  readonly tone: StatusTone;
}

const KIND_CHIPS: Readonly<Record<RunStopKind, ChipView>> = {
  "user-paused": { label: "Paused by you", tone: "attention" },
  "user-stopped": { label: "Stopped by you", tone: "stopped" },
  loop: { label: "Stopped by a loop guard", tone: "attention" },
  budget: { label: "Ran out of budget", tone: "attention" },
  timeout: { label: "Timed out", tone: "attention" },
  error: { label: "Stopped by an error", tone: "failed" },
  crash: { label: "Interrupted", tone: "attention" },
};

/** The chip for why a run is not finished: the label comes from the stop's `kind`. */
export function stopKindChip(kind: RunStopKind): ChipView {
  return KIND_CHIPS[kind];
}

const STATUS_CHIPS: Readonly<Record<DurableRunStatus, ChipView>> = {
  running: { label: "Running", tone: "running" },
  paused: { label: "Paused", tone: "attention" },
  stopped: { label: "Stopped", tone: "stopped" },
  failed: { label: "Failed", tone: "failed" },
  completed: { label: "Completed", tone: "done" },
  "awaiting-approval": { label: "Waiting for approval", tone: "attention" },
  "awaiting-interaction": { label: "Waiting for your answer", tone: "attention" },
};

/** The chip for a durable run's row status (running, paused, stopped, failed, awaiting-*). */
export function runStatusChip(status: DurableRunStatus): ChipView {
  return STATUS_CHIPS[status];
}

/** The loop guard's reason in plain words: what it saw, not its internal name. */
function loopHeadline(reason: string): string {
  if (reason.startsWith("loop_detected")) return "The agent kept repeating the same step, so it was stopped.";
  if (reason === "loop_graceful") return "The agent was going in circles, so it was stopped.";
  if (reason === "dispatcher-early-stop") return "The run was stopped early because it was not making progress.";
  return `The run was stopped (${reason}).`;
}

/**
 * A `budget` stop in plain words. The framework files the iteration cap (`max_iterations`)
 * under `budget`, and local models have no spend, so the reason decides the words.
 */
function budgetHeadline(reason: string): string {
  const r = reason.toLowerCase();
  if (/max[_ -]?iterations?|\biterations?\b/.test(r)) return "The run reached its iteration limit before it finished. Continue gives it more.";
  if (/cost|token|spend|budget|usd|dollar/.test(r)) return "The run reached its spending (or token) limit before it finished.";
  return "The run reached a limit before it finished.";
}

/** Why the run is not finished, in plain words, for the card's first line. */
export function stopHeadline(kind: RunStopKind, stop?: Pick<StopWire, "reason">): string {
  switch (kind) {
    case "user-stopped":
      return "You stopped this run. It can pick up where it left off.";
    case "user-paused":
      return "You paused this run. It can pick up where it left off.";
    case "loop":
      return loopHeadline(stop?.reason ?? "");
    case "budget":
      return budgetHeadline(stop?.reason ?? "");
    case "timeout":
      return "The run ran out of time before it finished.";
    case "error":
      return stop?.reason ? `The run hit an error (${stop.reason}).` : "The run hit an error.";
    case "crash":
      return "The run was interrupted (Cortex or the machine stopped while it was going).";
  }
}

const DONE_SHOWN = 6;
const LEFT_SHOWN = 5;

/** One labelled group of the stop card: a short list of mono values or titles. */
export interface StopFact {
  readonly label: string;
  readonly items: readonly string[];
  /** Values are tool names (machine text) rather than prose. */
  readonly mono: boolean;
}

const capped = (all: readonly string[], shown: number): string[] =>
  all.length > shown ? [...all.slice(0, shown), `and ${all.length - shown} more`] : [...all];

/**
 * What the stop card lists under its headline: the tool it repeated, the tools already
 * done (not re-run on Continue) and the rows still open. Empty groups are left out; a
 * run with no stop record (a crash) lists nothing.
 */
export function stopFacts(stop: StopWire | undefined): StopFact[] {
  if (stop === undefined) return [];
  const facts: StopFact[] = [];
  if (stop.repeatedTool) facts.push({ label: "Kept repeating", items: [stop.repeatedTool], mono: true });
  if (stop.toolsDone.length > 0) {
    facts.push({
      label: "Already done",
      items: capped(stop.toolsDone.map((t) => (t.calls > 1 ? `${t.tool} x${t.calls}` : t.tool)), DONE_SHOWN),
      mono: true,
    });
  }
  if (stop.unfinished.length > 0) facts.push({ label: "Left to do", items: capped(stop.unfinished, LEFT_SHOWN), mono: false });
  return facts;
}
