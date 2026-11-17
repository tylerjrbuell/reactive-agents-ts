/**
 * Model page Calibration and Spend sections (roadmap C13): plain-word rows for
 * the framework's calibration of a model (server `services/model-calibration.ts`)
 * and the spend stats over its recent runs (server `services/model-cost.ts`).
 * Rendering lives in `components/models/`.
 */
import { formatCost, formatRelativeTime, formatTokens } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";

/** Where a calibration value came from. */
export type CalibrationSource = "shipped" | "learned";

/** One calibration setting (`GET /api/model-calibration`). */
export interface CalibrationSetting {
  readonly key: string;
  readonly value: string | number;
  readonly priorValue?: string | number;
  readonly source: CalibrationSource;
}

/** Sums over the model's local run observations. */
export interface ObservationSummary {
  readonly sampleCount: number;
  readonly runs: number;
  readonly window: number;
  readonly threshold: number;
  readonly parallelRuns: number;
  readonly classifierMissRuns: number;
  readonly actOrAnswerRuns: number;
  readonly forcedCalls: number;
  readonly forcedCallsSucceeded: number;
  readonly noCallStallTurns: number;
  readonly unforcedToolWorkTurns: number;
  readonly lastAt?: string;
}

/** Entropy thresholds the reactive-intelligence sensor learned for the model. */
export interface EntropyCalibration {
  readonly sampleCount: number;
  readonly calibrated: boolean;
  readonly highEntropyThreshold: number;
  readonly convergenceThreshold: number;
  readonly driftDetected: boolean;
  readonly lastUpdated: number;
}

/** `GET /api/model-calibration?model=`. */
export interface ModelCalibrationView {
  readonly model: string;
  readonly status: "prior" | "none";
  readonly prior?: { readonly calibratedAt: string; readonly runsAveraged: number; readonly probeVersion: number };
  readonly settings: readonly CalibrationSetting[];
  readonly observations: ObservationSummary;
  readonly entropy: EntropyCalibration | null;
  /** What the strategy-choice bandit learned on this model; `null` when nothing is stored. */
  readonly bandit: StrategyLearning | null;
}

/** One strategy (bandit arm) for one task category (`GET /api/model-calibration`). */
export interface BanditArm {
  readonly strategy: string;
  /** Posterior mean success rate, `alpha / (alpha + beta)`. */
  readonly meanReward: number;
  /** Runs the strategy was scored on. */
  readonly trials: number;
  readonly alpha: number;
  readonly beta: number;
  /** ISO-8601 UTC. */
  readonly updatedAt: string;
}

/** The arms learned for one task category, most trials first. */
export interface BanditCategory {
  readonly taskCategory: string;
  readonly arms: readonly BanditArm[];
  readonly lastUpdated: string;
}

/** What the strategy-choice bandit learned on a model. */
export interface StrategyLearning {
  readonly categories: readonly BanditCategory[];
}

/** `GET /api/model-cost?provider=&model=`. */
export interface ModelCost {
  readonly runs: number;
  readonly successfulRuns: number;
  readonly calls: number;
  readonly tokens: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cachedTokensIn: number;
  readonly splitCalls: number;
  readonly costUsd: number;
  readonly costKnown: boolean;
  readonly costPerSuccessfulRun?: number;
}

/** What each calibration field is called and what it does, in plain words. */
const SETTINGS: Readonly<Record<string, { label: string; help: string; values?: Readonly<Record<string, string>> }>> = {
  optimalToolResultChars: {
    label: "Tool result size",
    help: "Tool results longer than this are shortened before the model reads them.",
  },
  systemPromptAttention: {
    label: "Attention to instructions",
    help: "How well the model keeps following the system prompt after several turns. Measured only: no harness behavior reads it yet.",
    values: { strong: "Strong", moderate: "Moderate", weak: "Weak" },
  },
  actOrAnswer: {
    label: "Act or answer",
    help: "What the harness does when the model answers while a tool call is still needed.",
    values: {
      proactive: "Ask for a tool call up front",
      retry: "Ask for a tool call after a miss",
      off: "Never force a tool call",
    },
  },
  classifierReliability: {
    label: "Tool classifier",
    help: "Whether the harness first asks the model which tools a task needs. Skipped when its picks were often not used.",
    values: { high: "Runs", low: "Skipped (unreliable)", skip: "Skipped" },
  },
  parallelCallCapability: {
    label: "Parallel tool calls",
    help: "How many tool calls the harness lets the model batch in one turn.",
    values: { reliable: "Batches calls", partial: "Some batching", "sequential-only": "One at a time" },
  },
  observationHandling: {
    label: "Shortened results",
    help: "What the model does with a shortened tool result; the harness keeps recall on when it needs the facts inline.",
    values: {
      "uses-recall": "Recalls the full result",
      "needs-inline-facts": "Needs facts inline",
      "hallucinate-risk": "May guess (facts kept inline)",
    },
  },
  toolCallDialect: {
    label: "Tool-call format",
    help: "How the harness reads the model's tool calls.",
    values: { "native-fc": "Native function calls", "text-parse": "Parsed from text", none: "None" },
  },
};

const plain = (key: string, v: string | number): string => {
  if (key === "optimalToolResultChars" && typeof v === "number") return `${v.toLocaleString("en-US")} characters`;
  return SETTINGS[key]?.values?.[String(v)] ?? String(v);
};

/** One calibration row for the page. */
export interface CalibrationRow {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  /** The value in plain words. */
  readonly value: string;
  /** The machine value (hover). */
  readonly raw: string;
  readonly source: CalibrationSource;
  /** `Learned from your runs (shipped: …)` or `Shipped calibration`. */
  readonly sourceLabel: string;
}

/** The calibration settings as page rows. */
export function calibrationRows(view: ModelCalibrationView): CalibrationRow[] {
  return view.settings.map((s) => ({
    key: s.key,
    label: SETTINGS[s.key]?.label ?? s.key,
    help: SETTINGS[s.key]?.help ?? "",
    value: plain(s.key, s.value),
    raw: String(s.value),
    source: s.source,
    sourceLabel:
      s.source === "learned"
        ? `Learned from your runs, applied only when learned calibration is on${s.priorValue !== undefined ? ` (shipped: ${plain(s.key, s.priorValue)})` : ""}`
        : "Shipped calibration",
  }));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The line above the rows: where the calibration comes from and what runs get. */
export function calibrationNote(view: ModelCalibrationView): string {
  if (view.status === "none") {
    return "No shipped calibration for this model, so runs use the harness defaults. Learning from your runs applies only to models with a shipped calibration.";
  }
  const p = view.prior;
  const measured = p
    ? `Measured ${new Date(p.calibratedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} over ${plural(p.runsAveraged, "probe run")}.`
    : "";
  const learned = view.settings.filter((s) => s.source === "learned").length;
  const tail =
    learned > 0
      ? `${plural(learned, "setting")} learned from your runs. A run applies them only when learned calibration is on (Lab, All framework options, calibration).`
      : "Your runs have not changed any setting.";
  return `${measured} ${tail} A run applies a community profile only when community calibration is on; it is not shown here.`.trim();
}

/** The observation line: how much the framework has seen of this model locally. */
export function observationLine(o: ObservationSummary, now: number = Date.now()): string {
  if (o.sampleCount === 0) return "No runs observed on this model yet.";
  const seen = `${plural(o.sampleCount, "run")} observed${o.sampleCount > o.runs ? ` (the last ${o.runs} kept)` : ""}`;
  const learning =
    o.runs < o.threshold
      ? `learning starts at ${o.threshold}`
      : "enough to learn from";
  const last = o.lastAt ? `, last ${formatRelativeTime(Date.parse(o.lastAt), now)}` : "";
  return `${seen}${last}; ${learning}.`;
}

/** One labelled stat (StatGrid item) with hover help. */
export interface InsightStat {
  readonly label: string;
  readonly value: string;
  readonly title: string;
}

/** What the observations say, as stats (empty with no observation). */
export function observationStats(o: ObservationSummary): InsightStat[] {
  if (o.runs === 0) return [];
  const items: InsightStat[] = [
    {
      label: "Parallel turns",
      value: `${o.parallelRuns} of ${o.runs} runs`,
      title: "Runs with at least one turn of two or more tool calls (decides Parallel tool calls).",
    },
    {
      label: "Classifier misses",
      value: `${o.classifierMissRuns} of ${o.runs} runs`,
      title: "Runs where the classifier asked for a tool the run never called (decides Tool classifier).",
    },
  ];
  if (o.actOrAnswerRuns > 0) {
    items.push(
      {
        label: "Forced calls that worked",
        value: `${o.forcedCallsSucceeded} of ${o.forcedCalls}`,
        title: "Tool calls the harness asked for whose every call ran and succeeded (decides Act or answer).",
      },
      {
        label: "Stalled turns",
        value: `${o.noCallStallTurns} of ${o.unforcedToolWorkTurns}`,
        title: "Turns that ended without a tool call while tool work was still outstanding (decides Act or answer).",
      },
    );
  }
  return items;
}

/** The entropy thresholds as stats, `[]` when nothing is stored. */
export function entropyStats(e: EntropyCalibration | null): InsightStat[] {
  if (!e) return [];
  return [
    {
      label: "Scored steps",
      value: e.sampleCount.toLocaleString("en-US"),
      title: e.calibrated ? "Enough scored steps: the thresholds below are learned." : "Not enough scored steps yet: the sensor still uses its defaults.",
    },
    {
      label: "Uncertain above",
      value: e.highEntropyThreshold.toFixed(2),
      title: "Entropy at or above this marks a step as uncertain.",
    },
    {
      label: "Settled below",
      value: e.convergenceThreshold.toFixed(2),
      title: "Entropy at or below this marks the run as converging.",
    },
    {
      label: "Drift",
      value: e.driftDetected ? "detected" : "none",
      title: "Whether recent steps scored differently from the learned baseline.",
    },
  ];
}

/** One strategy row under a task category. */
export interface StrategyArmRow {
  readonly strategy: string;
  /** `67%` (the success estimate). */
  readonly rate: string;
  /** `4 runs`. */
  readonly trials: string;
  /** Hover: the estimate's numbers. */
  readonly title: string;
  /** Highest success estimate in its category (ties: the first, which has the most runs). */
  readonly best: boolean;
}

/** One task category of the strategy-learning list. */
export interface StrategyCategoryRow {
  readonly category: string;
  /** `updated 3 hours ago`. */
  readonly updated: string;
  readonly arms: readonly StrategyArmRow[];
}

/** The bandit's arms as page rows, `[]` when nothing is stored. */
export function strategyLearningRows(b: StrategyLearning | null, now: number = Date.now()): StrategyCategoryRow[] {
  if (!b) return [];
  return b.categories.map((c) => {
    const best = c.arms.reduce<BanditArm | undefined>((m, a) => (!m || a.meanReward > m.meanReward ? a : m), undefined);
    return {
      category: c.taskCategory || "uncategorized",
      updated: `updated ${formatRelativeTime(Date.parse(c.lastUpdated), now)}`,
      arms: c.arms.map((a) => ({
        strategy: a.strategy,
        rate: `${Math.round(a.meanReward * 100)}%`,
        trials: plural(a.trials, "run"),
        title: `Success estimate ${a.alpha.toFixed(1)} / ${(a.alpha + a.beta).toFixed(1)} after ${plural(a.trials, "scored run")}.`,
        best: a === best,
      })),
    };
  });
}

/** The line under "Strategy learning". */
export function strategyLearningLine(b: StrategyLearning | null): string {
  if (!b) {
    return "No strategy results stored for this model yet. Runs with reactive intelligence record how each strategy did per kind of task, in the calibration database.";
  }
  return "How each strategy did on this model per kind of task, as the framework's strategy chooser learned it from your runs. A run counts as a success when its average uncertainty (entropy) stayed below 0.5; estimates start at 50% and move with each scored run.";
}

/** The spend stats; `[]` when no model call was recorded. */
export function costStats(c: ModelCost | null): InsightStat[] {
  if (!c || c.calls === 0) return [];
  const lowerBound = c.costKnown ? "" : "≥ ";
  const unpriced = c.costKnown ? "" : " Some calls reported no cost, so this is at least the amount shown.";
  const items: InsightStat[] = [
    {
      label: "Spend",
      value: `${lowerBound}${formatCost(c.costUsd)}`,
      title: `Priced by the framework over ${plural(c.calls, "model call")} in ${plural(c.runs, "finished run")}.${unpriced}`,
    },
    {
      label: "Per successful run",
      value: c.costPerSuccessfulRun !== undefined ? `${lowerBound}${formatCost(c.costPerSuccessfulRun)}` : "—",
      title:
        c.successfulRuns > 0
          ? `All spend divided by the ${plural(c.successfulRuns, "run")} that finished with a full answer, so failed runs count against the successes.`
          : "No run finished with a full answer yet.",
    },
    {
      label: "Tokens",
      value: formatTokens(c.tokens),
      title: "Input and output tokens over the model calls.",
    },
  ];
  if (c.splitCalls > 0) {
    const of = c.splitCalls < c.calls ? ` (${c.splitCalls} of ${c.calls} calls reported the split)` : "";
    items.push(
      { label: "Input", value: formatTokens(c.tokensIn), title: `Input tokens${of}.` },
      { label: "Output", value: formatTokens(c.tokensOut), title: `Output tokens${of}.` },
    );
  }
  if (c.cachedTokensIn > 0) {
    items.push({
      label: "Cached input",
      value: formatTokens(c.cachedTokensIn),
      title: "Input tokens served from the provider's prompt cache (billed at a discount).",
    });
  }
  return items;
}

/** Fetch the calibration view; `null` on any failure. */
export async function fetchModelCalibration(model: string): Promise<ModelCalibrationView | null> {
  try {
    const r = await fetch(`${CORTEX_SERVER_URL}/api/model-calibration?model=${encodeURIComponent(model)}`);
    return r.ok ? ((await r.json()) as ModelCalibrationView) : null;
  } catch {
    return null;
  }
}

/** Fetch the spend over the model's recent runs; `null` on any failure. */
export async function fetchModelCost(provider: string, model: string): Promise<ModelCost | null> {
  try {
    const r = await fetch(
      `${CORTEX_SERVER_URL}/api/model-cost?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`,
    );
    return r.ok ? ((await r.json()) as ModelCost) : null;
  } catch {
    return null;
  }
}
