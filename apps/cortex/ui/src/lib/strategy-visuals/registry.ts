/**
 * The strategy card's single extension point: which view a strategy gets, and how its card reads
 * (title, phase chip, summary, open state). Pure, so it is tested without a DOM; the view for each
 * kind is drawn by `components/strategy/StrategyCard.svelte` (the one switch over kinds). A strategy with no entry here still gets the
 * generic phase stepper, so a new strategy shows its phases the day it ships, then earns a view.
 *
 * The phases themselves (the label grammar and the fold) live in ui-core `strategy-phases.ts`.
 */
import {
  adaptiveChoiceLine,
  adaptiveChoiceOf,
  attemptsOf,
  DIRECT_SETTLED,
  planStepsOf,
  planSummaryOf,
  quietRunLine,
  reactLoopChip,
  strategySpecOf,
  totTreeOf,
  type ReactLoop,
  type StrategyRunState,
} from "@reactive-agents/ui-core";

/** The view a strategy gets. */
export type StrategyVisualKind =
  /** One row per phase the run entered (generic fallback). */
  | "stepper"
  /** Tree of thought: levels, best score per level. */
  | "tree"
  /** Rounds of draft / critique / improve, or code attempts. */
  | "attempts"
  /**
   * A plan-style strategy: per-step history (retries, patches, failures). When the goal-checks card
   * already draws the plan, this card shows only the steps with something to tell, or nothing.
   */
  | "plan"
  /** The ReAct loop: per iteration the thought, the tool action and its observation (reactive, react). */
  | "loop";

/** One strategy's view and the words it uses. */
export interface StrategyVisual {
  readonly kind: StrategyVisualKind;
  /** What one round is called in an `attempts` view. */
  readonly noun?: string;
}

/** Views by label prefix (`plan-execute`, not the registry name). */
export const STRATEGY_VISUALS: Readonly<Record<string, StrategyVisual>> = {
  "tree-of-thought": { kind: "tree" },
  reflexion: { kind: "attempts", noun: "Round" },
  "code-action": { kind: "attempts", noun: "Attempt" },
  "plan-execute": { kind: "plan" },
  blueprint: { kind: "plan" },
  // rewoo is an alias of the blueprint executor today (blueprint labels, resolved through its spec's
  // prefix); mapped here too so a `rewoo:*` label prefix draws the same plan-style card, not a stepper.
  rewoo: { kind: "plan" },
  // `react` resolves here through its label prefix. `direct` and `adaptive` keep the generic stepper:
  // direct has no loop, and adaptive hands over to the strategy it picked (whose own view then applies).
  reactive: { kind: "loop" },
};

const GENERIC: StrategyVisual = { kind: "stepper" };

/** The view for a strategy (its label prefix or registry name); the generic stepper when it has none. */
export function strategyVisualOf(strategy: string | undefined): StrategyVisual {
  if (!strategy) return GENERIC;
  return STRATEGY_VISUALS[strategy] ?? STRATEGY_VISUALS[strategySpecOf(strategy)?.pass ?? ""] ?? GENERIC;
}

/** What the card shows, in the reader's terms. */
export interface StrategyCardModel {
  /** False: draw nothing. */
  readonly show: boolean;
  readonly kind: StrategyVisualKind;
  readonly noun: string;
  /** Pill text: the strategy's name. */
  readonly title: string;
  /** Right of the title: the current phase while running, the summary once over. */
  readonly chip: string;
  /** Default open state: while it runs, or when a phase failed. */
  readonly openByDefault: boolean;
  /** A `plan` card beside the plan card: draw only the steps that have history worth showing. */
  readonly historyOnly: boolean;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The one-line summary of a finished run, per kind. */
function summaryOf(run: StrategyRunState, visual: StrategyVisual): string {
  if (visual.kind === "tree") {
    const levels = totTreeOf(run);
    if (levels.length === 0) return plural(run.rows.length, "phase");
    const best = Math.max(...levels.map((l) => l.best ?? 0));
    return `${plural(run.nodes.length, "node")}, best ${best.toFixed(2)}`;
  }
  if (visual.kind === "attempts") {
    const rounds = attemptsOf(run).filter((a) => a.n > 0).length;
    const base = rounds === 0 ? "first try" : plural(rounds, (visual.noun ?? "round").toLowerCase());
    // How it ended: the last critique's verdict (reflexion) or the last check's (code action).
    const last = (pick: (r: StrategyRunState["rows"][number]) => boolean | undefined): boolean | undefined => run.rows.map(pick).filter((v) => v !== undefined).at(-1);
    const accepted = last((r) => r.accepted);
    const verified = last((r) => (r.verify ? /^(pass|verified|ok)/i.test(r.verify.verdict) : undefined));
    const end = accepted === true ? "accepted" : accepted === false ? "not accepted" : verified === true ? "verified" : verified === false ? "not verified" : undefined;
    return end ? `${base}, ${end}` : base;
  }
  if (run.strategy === "direct") return DIRECT_SETTLED;
  const choice = adaptiveChoiceOf(run);
  // Adaptive that handed over to a strategy with no view of its own: say what it chose.
  if (choice && run.strategy === "adaptive") return adaptiveChoiceLine(choice);
  return planSummaryOf(run) ?? plural(run.rows.length, "phase");
}

/** The card's title: the strategy's name, led by "Adaptive →" when adaptive picked it. */
function titleOf(run: StrategyRunState, fallback: string): string {
  const name = run.label ?? run.strategy ?? fallback;
  return run.strategy !== "adaptive" && adaptiveChoiceOf(run) ? `Adaptive → ${name}` : name;
}

/**
 * The card for a run. `statusLine` is the live phase text (ui-core `strategyStatusOf`); `hasPlan` is true
 * when the goal-checks card already draws the strategy's plan, so a `plan` view adds nothing.
 */
export function strategyCardModel(
  run: StrategyRunState | undefined,
  opts: { readonly statusLine?: string | undefined; readonly hasPlan: boolean; readonly loop?: ReactLoop | undefined },
): StrategyCardModel {
  const visual = strategyVisualOf(run?.strategy);
  const empty: StrategyCardModel = { show: false, kind: visual.kind, noun: visual.noun ?? "Round", title: "", chip: "", openByDefault: false, historyOnly: false };
  if (!run || run.current === undefined || run.rows.length === 0) return empty;
  const historyOnly = visual.kind === "plan" && opts.hasPlan;
  // The plan card draws the plan; this card adds only what it cannot: a step's retries, patches, failures.
  if (historyOnly && !planStepsOf(run).some((s) => s.notable)) return empty;
  if (visual.kind === "loop") {
    // A loop with nothing in it yet (or a run that never thought or acted) has nothing to draw.
    const chip = opts.loop ? reactLoopChip(opts.loop, run.ended) : undefined;
    if (chip === undefined) return empty;
    return { show: true, kind: "loop", noun: "Iteration", title: titleOf(run, "Reactive"), chip, openByDefault: !run.ended, historyOnly: false };
  }
  const failed = run.rows.some((r) => r.status === "failed");
  return {
    show: true,
    kind: visual.kind,
    noun: visual.noun ?? "Round",
    title: titleOf(run, "Strategy"),
    chip: run.ended ? summaryOf(run, visual) : (opts.statusLine ?? quietRunLine(run.strategy)),
    openByDefault: !run.ended || failed,
    historyOnly,
  };
}
