/**
 * Model page calibration (roadmap C13): what the framework's calibration
 * resolver gives a run on this model, which tier each value came from, the
 * local run observations behind the learned values, and the entropy
 * thresholds the reactive-intelligence sensor learned.
 *
 * Every value comes from a framework reader: `loadCalibration` (the shipped
 * or user-cached prior, llm-provider), `resolveModelCalibration` (runtime: the
 * prior merged with local observations, the same call a run with
 * `calibration: "auto"` makes), `loadObservations` (reactive-intelligence),
 * `CalibrationStore.load` (the conformal entropy thresholds) and
 * `readBanditArmStats` (the strategy-choice bandit's arms, same DB file).
 * Cortex never opens those files itself and never writes calibration.
 *
 * Provenance: the framework returns the merged calibration without saying
 * which tier set each field, so a field is `learned` when the resolved value
 * differs from the prior, `shipped` when it equals it. The community profile
 * a run may fetch at start (`communityCalibration`, on by default) is not
 * fetched here; `communityNote` says so on the page.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCalibration, type ModelCalibration } from "@reactive-agents/llm-provider";
import { resolveModelCalibration } from "@reactive-agents/runtime";
import {
  CalibrationStore,
  loadObservations,
  OBSERVATIONS_WINDOW,
  OVERRIDE_THRESHOLD,
  readBanditArmStats,
  type ArmStatsView,
  type RunObservation,
} from "@reactive-agents/reactive-intelligence";

/** Where a calibration value came from. */
export type CalibrationSource = "shipped" | "learned";

/** One calibration setting as the run receives it. */
export interface CalibrationSetting {
  /** `ModelCalibration` field name. */
  readonly key: CalibrationKey;
  /** The resolved value (what the run gets). */
  readonly value: string | number;
  /** The prior's value, when the learned value replaced it. */
  readonly priorValue?: string | number;
  readonly source: CalibrationSource;
}

/** The calibration fields the Model page shows (the ones with a live harness consumer, plus attention). */
export const CALIBRATION_KEYS = [
  "optimalToolResultChars",
  "systemPromptAttention",
  "actOrAnswer",
  "classifierReliability",
  "parallelCallCapability",
  "observationHandling",
  "toolCallDialect",
] as const;

/** A calibration field the Model page shows. */
export type CalibrationKey = (typeof CALIBRATION_KEYS)[number];

/** Sums over the local run observations (counts only, no derived decision). */
export interface ObservationSummary {
  /** Runs observed in total (the file keeps the last `window`). */
  readonly sampleCount: number;
  /** Runs in the kept window. */
  readonly runs: number;
  readonly window: number;
  /** Runs needed before observations may override the prior. */
  readonly threshold: number;
  /** Runs with at least one turn of two or more tool calls. */
  readonly parallelRuns: number;
  /** Runs where the classifier required a tool the run never called. */
  readonly classifierMissRuns: number;
  /** Runs that recorded act-or-answer counts (older observation files did not). */
  readonly actOrAnswerRuns: number;
  readonly forcedCalls: number;
  readonly forcedCallsSucceeded: number;
  readonly noCallStallTurns: number;
  readonly unforcedToolWorkTurns: number;
  /** ISO time of the newest observation. */
  readonly lastAt?: string;
}

/** The reactive-intelligence entropy thresholds for this model (`CalibrationStore`). */
export interface EntropyCalibration {
  readonly sampleCount: number;
  readonly calibrated: boolean;
  readonly highEntropyThreshold: number;
  readonly convergenceThreshold: number;
  readonly driftDetected: boolean;
  readonly lastUpdated: number;
}

/** Response of `GET /api/model-calibration?model=`. */
export interface ModelCalibrationView {
  readonly model: string;
  /**
   * `prior`: a shipped or user-cached calibration exists, so runs get the
   * settings below. `none`: no prior, so runs get no calibration and the
   * harness uses its own defaults (local observations do not apply alone:
   * `resolveModelCalibration` returns nothing without a prior).
   */
  readonly status: "prior" | "none";
  /** When the prior was measured, and over how many probe runs. */
  readonly prior?: { readonly calibratedAt: string; readonly runsAveraged: number; readonly probeVersion: number };
  readonly settings: readonly CalibrationSetting[];
  readonly observations: ObservationSummary;
  /** `null` when the sensor has stored nothing for this model. */
  readonly entropy: EntropyCalibration | null;
  /**
   * Strategy-choice (bandit) arm stats the framework persisted for this model
   * (table `bandit_arms` in the calibration DB, read by `readBanditArmStats`).
   * `null` when the DB file is missing or holds no arm for the model.
   */
  readonly bandit: StrategyLearning | null;
}

/** One strategy (bandit arm) for one task category. */
export interface BanditArm {
  /** Strategy name (the arm id). */
  readonly strategy: string;
  /** Posterior mean success rate, `alpha / (alpha + beta)`. */
  readonly meanReward: number;
  /** Runs the strategy was scored on (`pulls`). */
  readonly trials: number;
  readonly alpha: number;
  readonly beta: number;
  /** ISO-8601 UTC. */
  readonly updatedAt: string;
}

/** The arms learned for one task category, most trials first (the framework's order). */
export interface BanditCategory {
  readonly taskCategory: string;
  readonly arms: readonly BanditArm[];
  /** Newest `updatedAt` over the arms. */
  readonly lastUpdated: string;
}

/** What the strategy-choice bandit learned on this model. */
export interface StrategyLearning {
  readonly categories: readonly BanditCategory[];
}

/** Group the framework's arm stats by task category (categories in the framework's order). Pure. */
export function strategyLearningOf(arms: readonly ArmStatsView[]): StrategyLearning | null {
  if (arms.length === 0) return null;
  const byCategory = new Map<string, BanditArm[]>();
  for (const a of arms) {
    const list = byCategory.get(a.taskCategory) ?? [];
    list.push({
      strategy: a.armId,
      meanReward: a.meanReward,
      trials: a.pulls,
      alpha: a.alpha,
      beta: a.beta,
      updatedAt: a.updatedAt,
    });
    byCategory.set(a.taskCategory, list);
  }
  return {
    categories: [...byCategory.entries()].map(([taskCategory, list]) => ({
      taskCategory,
      arms: list,
      lastUpdated: list.reduce((m, a) => (a.updatedAt > m ? a.updatedAt : m), list[0]!.updatedAt),
    })),
  };
}

/** Store locations (tests point them at temp dirs). */
export interface ModelCalibrationPaths {
  /** Observations dir; default: the framework's (`REACTIVE_AGENTS_OBSERVATIONS_DIR`, else `~/.reactive-agents/observations`). */
  readonly observationsDir?: string;
  /** Entropy calibration DB; default: the framework's `~/.reactive-agents/calibration.db`. */
  readonly calibrationDbPath?: string;
}

const isScalar = (v: unknown): v is string | number => typeof v === "string" || typeof v === "number";

/** Sum the observation counts. Pure. */
export function summarizeObservations(runs: readonly RunObservation[], sampleCount: number): ObservationSummary {
  let parallelRuns = 0;
  let classifierMissRuns = 0;
  let actOrAnswerRuns = 0;
  let forcedCalls = 0;
  let forcedCallsSucceeded = 0;
  let noCallStallTurns = 0;
  let unforcedToolWorkTurns = 0;
  for (const r of runs) {
    if (r.parallelTurnCount > 0) parallelRuns += 1;
    const called = new Set(r.classifierActuallyCalled);
    if (r.classifierRequired.some((name) => !called.has(name))) classifierMissRuns += 1;
    if (typeof r.forcedCalls === "number" && typeof r.unforcedToolWorkTurns === "number") {
      actOrAnswerRuns += 1;
      forcedCalls += r.forcedCalls;
      forcedCallsSucceeded += r.forcedCallsSucceeded ?? 0;
      noCallStallTurns += r.noCallStallTurns ?? 0;
      unforcedToolWorkTurns += r.unforcedToolWorkTurns;
    }
  }
  const last = runs[runs.length - 1];
  return {
    sampleCount,
    runs: runs.length,
    window: OBSERVATIONS_WINDOW,
    threshold: OVERRIDE_THRESHOLD,
    parallelRuns,
    classifierMissRuns,
    actOrAnswerRuns,
    forcedCalls,
    forcedCallsSucceeded,
    noCallStallTurns,
    unforcedToolWorkTurns,
    ...(last ? { lastAt: last.at } : {}),
  };
}

/** The shown settings: resolved value per key, `learned` where it differs from the prior. Pure. */
export function calibrationSettingsOf(
  prior: ModelCalibration,
  resolved: ModelCalibration,
): CalibrationSetting[] {
  const out: CalibrationSetting[] = [];
  for (const key of CALIBRATION_KEYS) {
    const value = resolved[key];
    if (!isScalar(value)) continue;
    const before = prior[key];
    const learned = before !== value;
    out.push({
      key,
      value,
      source: learned ? "learned" : "shipped",
      ...(learned && isScalar(before) ? { priorValue: before } : {}),
    });
  }
  return out;
}

const defaultCalibrationDbPath = (): string => join(homedir(), ".reactive-agents", "calibration.db");

/**
 * Reads calibration through the framework. One `CalibrationStore` is opened per
 * DB path and kept (the store has no close), and only once the file exists, so
 * looking never creates a calibration database.
 */
export function makeModelCalibrationReader(paths: ModelCalibrationPaths = {}) {
  const stores = new Map<string, CalibrationStore>();
  const entropyOf = (model: string): EntropyCalibration | null => {
    const dbPath = paths.calibrationDbPath ?? defaultCalibrationDbPath();
    if (!existsSync(dbPath)) return null;
    let store = stores.get(dbPath);
    if (!store) {
      store = new CalibrationStore(dbPath);
      stores.set(dbPath, store);
    }
    const row = store.load(model);
    if (!row) return null;
    return {
      sampleCount: row.sampleCount,
      calibrated: row.calibrated,
      highEntropyThreshold: row.highEntropyThreshold,
      convergenceThreshold: row.convergenceThreshold,
      driftDetected: row.driftDetected,
      lastUpdated: row.lastUpdated,
    };
  };

  // `readBanditArmStats` opens and closes the file per call (no handle kept).
  // Only when the file exists: opening it creates the DB.
  const banditOf = (model: string): StrategyLearning | null => {
    const dbPath = paths.calibrationDbPath ?? defaultCalibrationDbPath();
    if (!existsSync(dbPath)) return null;
    return strategyLearningOf(readBanditArmStats(dbPath, { modelId: model }));
  };

  return {
    /** The calibration view for one model id. */
    read(model: string): ModelCalibrationView {
      const observationsDir = paths.observationsDir ?? process.env["REACTIVE_AGENTS_OBSERVATIONS_DIR"];
      const obs = loadObservations(model, observationsDir ? { baseDir: observationsDir } : {});
      const observations = summarizeObservations(obs.runs, obs.sampleCount);
      const prior = loadCalibration(model);
      const resolved = prior
        ? resolveModelCalibration(model, observationsDir ? { observationsBaseDir: observationsDir } : {})
        : undefined;
      const entropy = entropyOf(model);
      const bandit = banditOf(model);
      if (!prior || !resolved) {
        return { model, status: "none", settings: [], observations, entropy, bandit };
      }
      return {
        model,
        status: "prior",
        prior: { calibratedAt: prior.calibratedAt, runsAveraged: prior.runsAveraged, probeVersion: prior.probeVersion },
        settings: calibrationSettingsOf(prior, resolved),
        observations,
        entropy,
        bandit,
      };
    },
  };
}

/** The reader type the route takes. */
export type ModelCalibrationReader = ReturnType<typeof makeModelCalibrationReader>;
