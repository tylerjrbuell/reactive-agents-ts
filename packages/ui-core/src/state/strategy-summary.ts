/**
 * What a settled (or running) strategy run says in one line, for the strategies whose steps carry no
 * rich payload of their own: adaptive (which strategy it chose and why), direct (one pass) and the
 * plan strategies (plan-execute, blueprint, rewoo: steps done / failed, patches). Pure and
 * framework-free, derived from the folded {@link StrategyRunState} so a stored run reads the same as a
 * live one. A strategy with a richer view (tree, attempts, loop) keeps that view's own summary.
 */
import { strategySpecOf, type StrategyRunState } from "./strategy-phases.js";
import { planStepsOf } from "./strategy-plan-history.js";

/** How adaptive picked its strategy. */
export type AdaptiveHow = "heuristic" | "classifier" | "default" | "cheaper" | "fallback" | "explicit";

/** The framework's `strategy-choice` reasons, as the way adaptive picked. */
const HOW_OF_REASON: Readonly<Record<string, AdaptiveHow>> = {
  heuristic: "heuristic",
  classifier: "classifier",
  "classifier-skip": "default",
  "cost-downgrade": "cheaper",
  fallback: "fallback",
  explicit: "explicit",
};

/** Fallback when a payload's reason is free text: the adaptive phase that carried it says how. */
const HOW_OF_PHASE: Readonly<Record<string, AdaptiveHow>> = {
  heuristic: "heuristic",
  select: "classifier",
  "classifier-skip": "default",
  "cost-downgrade": "cheaper",
  fallback: "fallback",
};

/** The strategy adaptive delegated to, and why. */
export interface AdaptiveChoice {
  /** The registry name it chose (`reactive`, `blueprint`, ...). */
  readonly chosen: string;
  readonly how: AdaptiveHow;
  /** The strategy it first chose before a cost downgrade swapped it. */
  readonly from?: string;
  /** The framework's own words for why, when its reason was not one of the known kinds. */
  readonly reason?: string;
}

const FROM_NOTE = /^from\s+([a-z][a-z-]*)/i;
const HEURISTIC =/Heuristic(?: pre-classifier selected)?:?\s+([a-z][a-z-]*)/i;
const SELECTED = /Selected strategy:\s*([a-z][a-z-]*)/i;
const DOWNGRADE = /cost-downgrade\s+([a-z][a-z-]*)\s*(?:→|->)\s*([a-z][a-z-]*)/i;

/**
 * The choice adaptive made, read from its rows (`select`, `heuristic`, `classifier-skip`,
 * `cost-downgrade`, `fallback`) in the order they ran; the latest wins. `undefined` when the run has
 * no adaptive row, or none whose text names a strategy. The framework reports the choice only as the
 * step's narration, so the strategy name is read from that line (`StrategyRow.note`).
 */
export function adaptiveChoiceOf(run: StrategyRunState): AdaptiveChoice | undefined {
  let choice: AdaptiveChoice | undefined;
  for (const row of run.rows) {
    const note = row.note ?? "";
    if (row.choice) {
      // The structured pick wins; the narration regexes below only run for a framework that sends none.
      const how = HOW_OF_REASON[row.choice.reason] ?? HOW_OF_PHASE[row.phase] ?? "classifier";
      choice = {
        chosen: row.choice.selected.toLowerCase(),
        how,
        // cost-downgrade: `selected` is the NEW strategy and the note starts "from <old>: <reason>".
        ...(how === "cheaper" ? (() => { const from = FROM_NOTE.exec(row.choice.note ?? "")?.[1]?.toLowerCase() ?? choice?.chosen; return from ? { from } : {}; })() : {}),
        ...(row.choice.reason.length > 0 && HOW_OF_REASON[row.choice.reason] === undefined ? { reason: row.choice.reason } : {}),
      };
    } else if (row.phase === "heuristic") {
      const m = HEURISTIC.exec(note);
      if (m) choice = { chosen: m[1]!.toLowerCase(), how: "heuristic" };
    } else if (row.phase === "select") {
      const m = SELECTED.exec(note);
      if (m) choice = { chosen: m[1]!.toLowerCase(), how: "classifier" };
    } else if (row.phase === "classifier-skip") {
      choice = { chosen: "reactive", how: "default" };
    } else if (row.phase === "cost-downgrade") {
      const m = DOWNGRADE.exec(note);
      if (m) choice = { chosen: m[2]!.toLowerCase(), how: "cheaper", from: m[1]!.toLowerCase() };
    } else if (row.phase === "fallback") {
      choice = { chosen: "reactive", how: "fallback" };
    }
  }
  return choice;
}

const HOW: Readonly<Record<AdaptiveHow, string>> = {
  heuristic: "by task shape",
  classifier: "by classifier",
  default: "default, classifier skipped",
  cheaper: "cheaper pick",
  fallback: "fallback",
  explicit: "set by the caller",
};

/** "chose Reactive (by task shape)": the line that says what adaptive picked and why. */
export function adaptiveChoiceLine(choice: AdaptiveChoice): string {
  const name = strategySpecOf(choice.chosen)?.label ?? choice.chosen;
  const why = choice.reason !== undefined ? (choice.reason.length > 80 ? `${choice.reason.slice(0, 80)}…` : choice.reason) : HOW[choice.how];
  return `chose ${name} (${why})`;
}

/** Steps of a plan strategy, counted from the rows. */
export interface PlanProgress {
  readonly steps: number;
  readonly done: number;
  readonly failed: number;
  /** Steps whose latest word is a retry. */
  readonly retrying: number;
  /** Plan rewrites: patch, refine and augment rows. */
  readonly revisions: number;
  /** Retries across all steps (from each step's history, so a settled step still counts). */
  readonly retries: number;
  /** Steps that were patched. */
  readonly patched: number;
}

const REVISION_PHASES: ReadonlySet<string> = new Set(["patch", "refine", "augment", "degrade"]);

/** Step and revision counts of a plan-style run (plan-execute, blueprint, rewoo). */
export function planProgressOf(run: StrategyRunState): PlanProgress {
  const steps = run.rows.filter((r) => r.phase === "step");
  const views = planStepsOf(run);
  return {
    steps: steps.length,
    done: steps.filter((r) => r.status === "done" && r.sub !== "failed").length,
    failed: steps.filter((r) => r.status === "failed").length,
    retrying: steps.filter((r) => r.sub?.startsWith("retry") === true).length,
    revisions: run.rows.filter((r) => REVISION_PHASES.has(r.phase)).length,
    retries: views.reduce((n, v) => n + v.retries, 0),
    patched: views.filter((v) => v.patched).length,
  };
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "3 steps, 1 failed, plan revised twice": the settled line of a plan-style run; `undefined` when no step ran. */
export function planSummaryOf(run: StrategyRunState): string | undefined {
  const p = planProgressOf(run);
  if (p.steps === 0) return undefined;
  const parts = [plural(p.steps, "step")];
  if (p.failed > 0) parts.push(`${p.failed} failed`);
  if (p.retries > 0) parts.push(p.retries === 1 ? "1 retry" : `${p.retries} retries`);
  if (p.patched > 0) parts.push(`${p.patched} patched`);
  if (p.revisions > 0) parts.push(p.revisions === 1 ? "plan revised" : `plan revised ${p.revisions} times`);
  return parts.join(", ");
}

/** The running line of a strategy whose phase table has nothing to name (direct, a bare reactive pass). */
export function quietRunLine(strategy: string | undefined): string {
  return strategy === "direct" ? "Answering" : "Working";
}

/** The settled line of a direct run: one pass, no loop. */
export const DIRECT_SETTLED = "answered in one pass";
