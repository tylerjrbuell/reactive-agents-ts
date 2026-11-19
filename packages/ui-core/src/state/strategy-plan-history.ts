/**
 * Per-step history of a plan-style strategy run (plan-execute-reflect, blueprint, rewoo): every
 * step keeps the ordered events it went through (started, retry, patched, failed, done, reflected)
 * instead of only its latest sub-label, so a retry or patch stays visible after the step settles and
 * after a reload. Events come from the `kernelPass` labels (`step-N:start|done|failed|retry-K|patch`)
 * today and from the structured `{ kind: "plan-step" }` payload when the framework sends one (the
 * payload wins). Also the structured `{ kind: "strategy-choice" }` payload adaptive reports.
 *
 * Pure, framework-free and self-contained (type imports only), so `strategy-phases.ts` can fold with
 * it and a builder's own chat UI reads the same history.
 */
import type { StrategyRunState } from "./strategy-phases.js";

/** What happened to a plan step. */
export type PlanStepEventKind = "started" | "retry" | "patched" | "reflected" | "failed" | "done";

/** One thing that happened to a step, oldest first in {@link StrategyRowHistory}. */
export interface PlanStepEvent {
  readonly kind: PlanStepEventKind;
  /** Retry number (`retry-2` is attempt 2) or the framework's attempt count. */
  readonly attempt?: number;
  /** Why: the failure reason, the retry's previous error, the patch detail. */
  readonly note?: string;
}

/** Structured `plan-step` payload (core `ReasoningStepData`), as read by the UI. */
export interface PlanStepPayload {
  /** 0-based, as the framework counts steps (the label's `step-N` is `stepIndex + 1`). */
  readonly stepIndex: number;
  readonly status: PlanStepEventKind;
  readonly attempt?: number;
  readonly note?: string;
}

/** Structured `strategy-choice` payload adaptive reports: the strategy it picked and why. */
export interface StrategyChoicePayload {
  readonly selected: string;
  readonly reason: string;
  readonly note?: string;
}

const KINDS: ReadonlySet<string> = new Set<PlanStepEventKind>(["started", "retry", "patched", "reflected", "failed", "done"]);

/** Events kept per step in memory; the storage caps cut further. */
const MAX_HISTORY = 24;

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

/** A `plan-step` payload read defensively; `undefined` unless it has a step index and a known status. */
export function planStepPayloadOf(raw: unknown): PlanStepPayload | undefined {
  const r = record(raw);
  if (!r) return undefined;
  const stepIndex = count(r.stepIndex);
  const status = text(r.status);
  if (stepIndex === undefined || status === undefined || !KINDS.has(status)) return undefined;
  const attempt = count(r.attempt);
  const note = text(r.note);
  return { stepIndex, status: status as PlanStepEventKind, ...(attempt !== undefined ? { attempt } : {}), ...(note !== undefined ? { note } : {}) };
}

/** A `strategy-choice` payload read defensively; `undefined` unless it names the selected strategy. */
export function strategyChoicePayloadOf(raw: unknown): StrategyChoicePayload | undefined {
  const r = record(raw);
  if (!r) return undefined;
  const selected = text(r.selected);
  if (selected === undefined) return undefined;
  const note = text(r.note);
  return { selected, reason: typeof r.reason === "string" ? r.reason : "", ...(note !== undefined ? { note } : {}) };
}

/** The slice of a step this module reads (a `StrategyStep` satisfies it). */
export interface HistorySource {
  readonly phase: string;
  readonly n?: number;
  readonly sub?: string;
  readonly note?: string;
  readonly planStep?: PlanStepPayload;
}

const RETRY = /^retry(?:-(\d+))?$/;

/** The event a label's sub-part stands for (`start`, `done`, `failed`, `retry-K`, `patch`); `undefined` for none. */
function eventOfLabel(s: HistorySource): PlanStepEvent | undefined {
  const sub = s.sub;
  if (sub === undefined) return undefined;
  const note = s.note !== undefined ? { note: s.note } : {};
  if (sub === "start") return { kind: "started" };
  if (sub === "done") return { kind: "done", ...note };
  if (sub === "failed") return { kind: "failed", ...note };
  if (sub === "patch") return { kind: "patched", ...note };
  const retry = RETRY.exec(sub);
  // `retry-K` is the Kth retry; the framework's payload `attempt` counts the attempt about to run (K + 1).
  if (retry) return { kind: "retry", ...(retry[1] !== undefined ? { attempt: Number(retry[1]) + 1 } : {}), ...note };
  return undefined;
}

/** Where a step's event lands and what it is, or `undefined` when the step says nothing about a plan step. */
export interface HistoryTarget {
  /** Row key of the step the event belongs to (`step-2`). */
  readonly key: string;
  readonly event: PlanStepEvent;
}

/**
 * The history event a folded step adds. A `step` phase with a number is its own step (payload first,
 * label second). A payload on another phase (`reflect-1` with `{ stepIndex: 2, status: "reflected" }`)
 * lands on step `stepIndex + 1`. A `reflect-N` label alone is a plan-level refinement round, never a step's.
 */
export function historyTargetOf(s: HistorySource): HistoryTarget | undefined {
  const p = s.planStep;
  if (s.phase === "step" && s.n !== undefined) {
    const event: PlanStepEvent | undefined = p
      ? { kind: p.status, ...(p.attempt !== undefined ? { attempt: p.attempt } : {}), ...(p.note !== undefined ? { note: p.note } : {}) }
      : eventOfLabel(s);
    return event ? { key: `step-${s.n}`, event } : undefined;
  }
  // `degrade` reports a plan-level failure (stepIndex 0), not step 1's.
  if (p && s.phase !== "degrade") {
    return { key: `step-${p.stepIndex + 1}`, event: { kind: p.status, ...(p.attempt !== undefined ? { attempt: p.attempt } : {}), ...(p.note !== undefined ? { note: p.note } : {}) } };
  }
  return undefined;
}

/** Append an event, dropping an exact repeat of the last one and keeping the newest {@link MAX_HISTORY}. */
export function pushHistory(history: readonly PlanStepEvent[] | undefined, event: PlanStepEvent): readonly PlanStepEvent[] {
  const last = history?.at(-1);
  if (last && last.kind === event.kind && last.attempt === event.attempt && last.note === event.note) return history!;
  const next = [...(history ?? []), event];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/** One plan step as the card draws it. */
export interface PlanStepView {
  readonly key: string;
  readonly label: string;
  readonly n?: number;
  readonly status: "running" | "done" | "failed";
  readonly events: readonly PlanStepEvent[];
  readonly retries: number;
  readonly patched: boolean;
  /** Has a retry, a patch or a failure worth showing even when a plan card already draws the plan. */
  readonly notable: boolean;
}

/** The steps of a plan-style run with their history, in the order they ran. */
export function planStepsOf(run: StrategyRunState): readonly PlanStepView[] {
  return run.rows
    .filter((r) => r.phase === "step")
    .map((r): PlanStepView => {
      const events = r.history ?? [];
      const retries = events.filter((e) => e.kind === "retry").length;
      const patched = events.some((e) => e.kind === "patched");
      return {
        key: r.key,
        label: r.label,
        ...(r.n !== undefined ? { n: r.n } : {}),
        status: r.status,
        events,
        retries,
        patched,
        notable: retries > 0 || patched || r.status === "failed" || events.some((e) => e.kind === "failed"),
      };
    });
}

/** Short badge words for a step: "retried 2×", "patched", "failed". Empty for a clean step. */
export function planStepBadgesOf(step: PlanStepView): readonly string[] {
  const out: string[] = [];
  if (step.retries > 0) out.push(step.retries === 1 ? "retried once" : `retried ${step.retries} times`);
  if (step.patched) out.push("patched");
  if (step.status === "failed" || step.events.some((e) => e.kind === "failed")) out.push("failed");
  return out;
}

const EVENT_WORD: Readonly<Record<PlanStepEventKind, string>> = {
  started: "Started",
  retry: "Retry",
  patched: "Patched",
  reflected: "Reflected on",
  failed: "Failed",
  done: "Done",
};

/** One history line: "Retry 2: previous error ...", "Failed: tool timed out", "Done". */
export function planStepEventLine(e: PlanStepEvent): string {
  const head = e.kind === "retry" && e.attempt !== undefined ? `${EVENT_WORD.retry}, attempt ${e.attempt}` : EVENT_WORD[e.kind];
  return e.note ? `${head}: ${e.note}` : head;
}
