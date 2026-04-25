// packages/testing/src/gate/types.ts
//
// North Star Test Gate — type contracts for tier-1 control-flow regressions.
// Spec: docs/superpowers/specs/2026-04-25-north-star-test-gate.md §2.3, §6.5.
//
// Every scenario is a self-contained ScenarioModule that the runner auto-
// discovers via glob. No central registry edit when adding/removing scenarios.

import type { ScenarioConfig, ScenarioResult } from "../harness/scenario.js";

// ─── Scenario-module shape ────────────────────────────────────────────────────

/**
 * A single failure-mode regression scenario, contributed as one file in
 * `packages/testing/src/gate/scenarios/cf-*.ts`. Every scenario must map
 * to a documented weakness ID (W#) or architectural gap (G#/IC#/S0.#).
 *
 * Generic feature-coverage scenarios are excluded by spec; the gate exists
 * to catch *specific* regressions, not to inventory marketed competencies.
 */
export interface ScenarioModule {
  /**
   * Stable identifier matching the file basename: `cf-NN-short-slug`.
   * Filename and id MUST match exactly so health-tracking can attribute
   * regressions to the right scenario across renames.
   */
  readonly id: string;

  /**
   * Weakness or gap this scenario protects against. Format: `W6`, `G-3`,
   * `IC-13`, `S0.2`, `Principle-11`, etc. Cross-referenced against
   * `harness-reports/loop-state.json` so harness-improvement-loop sessions
   * can detect uncovered weaknesses.
   */
  readonly targetedWeakness: string;

  /**
   * Commit SHA (short, 8 chars) that closed this gap. The gate's failure
   * message points readers here so the original fix is one click away.
   */
  readonly closingCommit: string;

  /**
   * Human-readable description of what regression turns this scenario red.
   * Surfaces in `bun run gate:explain <id>` output.
   */
  readonly description: string;

  /**
   * Configuration passed to `runScenario`. Test-mode by default (no API
   * key required). The runner adds standard tracing dir / max iterations
   * if not provided.
   */
  readonly config: ScenarioConfig;

  /**
   * Optional scenario-specific assertions captured into the outcome's
   * `customAssertions` map. Use this when the default outcome capture
   * (events, terminatedBy, etc.) doesn't express the failure mode.
   *
   * Receives the resolved ScenarioResult; returns a flat record of named
   * primitive values that diff cleanly in JSON.
   */
  readonly customAssertions?: (
    result: ScenarioResult,
  ) => Record<string, number | string | boolean | null>;
}

// ─── Per-scenario outcome ─────────────────────────────────────────────────────

/**
 * What one run of one scenario captured. Stable across re-runs because
 * `withTestScenario` produces a deterministic LLM script. Any divergence
 * between current and baseline outcome means either a regression or an
 * intentional behavioral change requiring a `BASELINE-UPDATE:` trailer.
 */
export interface Tier1ScenarioOutcome {
  /** Run terminal status from the trace `run-completed` event. */
  readonly status: "success" | "failure";

  /** Outer kernel iteration count from the trace. */
  readonly iterations: number;

  /** How the kernel exited. See `packages/core/src/types/result.ts`. */
  readonly terminatedBy:
    | "final_answer_tool"
    | "final_answer"
    | "max_iterations"
    | "end_turn"
    | "llm_error"
    | "unknown";

  /** Derived from `terminatedBy` per `deriveGoalAchieved`. */
  readonly goalAchieved: boolean | null;

  /** Sorted unique tool names that completed (from `tool-call-end` events). */
  readonly toolCallsObserved: readonly string[];

  /** Sorted unique decision types from `intervention-dispatched` events. */
  readonly interventionsDispatched: readonly string[];

  /** Sorted unique site strings from `ErrorSwallowed` events (if any). */
  readonly errorSwallowedSites: readonly string[];

  /** Sorted unique redactor names that triggered (if any). */
  readonly redactorsTriggered: readonly string[];

  /**
   * Scenario-specific named assertions returned by `ScenarioModule.customAssertions`.
   * Empty object when the scenario doesn't define any.
   */
  readonly customAssertions: Record<string, number | string | boolean | null>;
}

// ─── Top-level baseline artifact ──────────────────────────────────────────────

/**
 * The full Tier-1 baseline written to
 * `harness-reports/integration-control-flow-baseline.json`.
 *
 * The gate test deep-equals this against a fresh runner output. Any
 * divergence is either a regression (fail) or an intentional change
 * (developer runs `bun run gate:update` and includes `BASELINE-UPDATE:`
 * in the commit message).
 */
export interface Tier1Baseline {
  readonly schemaVersion: 1;

  /** Informational only; the gate does NOT compare timestamps. */
  readonly capturedAt: string;
  readonly bunVersion: string;

  /**
   * Per-scenario outcome, keyed by scenario id. Sorted alphabetically on
   * write so JSON diffs are stable across runs.
   */
  readonly scenarios: Record<string, Tier1ScenarioOutcome>;
}

// ─── Scenario-health sidecar (§6.5.3) ─────────────────────────────────────────

/**
 * Per-scenario meta tracked across executions. Surfaces "is this scenario
 * still earning its place?" — read by harness-improvement-loop sessions to
 * suggest retirement candidates and uncovered weaknesses.
 *
 * Written to `harness-reports/integration-control-flow-scenario-health.json`.
 */
export interface ScenarioHealth {
  readonly schemaVersion: 1;
  readonly scenarios: Record<string, ScenarioHealthEntry>;
}

export interface ScenarioHealthEntry {
  /** Total times this scenario has executed (every gate run increments). */
  readonly executions: number;

  /** ISO timestamp of most recent execution. */
  readonly lastExecutedAt: string;

  /**
   * Number of times the gate failed on this scenario (regression caught).
   * High value = scenario is earning its place. Zero over many runs =
   * candidate for retirement OR scenario isn't expressive enough.
   */
  readonly regressionsCaught: number;

  /** ISO timestamp of most recent regression catch (or null). */
  readonly lastRegressionAt: string | null;

  /** ISO timestamp of most recent baseline update for this scenario. */
  readonly baselineUpdatedAt: string;

  /**
   * Number of intentional baseline updates. High value = unstable
   * underlying behavior (the scenario keeps drifting); review whether
   * the scenario or the framework needs change.
   */
  readonly baselineUpdateCount: number;

  /**
   * Targeted weakness ID — copied from the ScenarioModule for cross-
   * reference against `harness-reports/loop-state.json`.
   */
  readonly targetedWeakness: string;
}

// ─── Diff result (§2.4 + §6.5.2) ──────────────────────────────────────────────

/**
 * Output of comparing a fresh runner outcome against a baseline outcome.
 * The gate's failure message is rendered from this — names the weakness
 * the scenario protects, the closing commit, and which fields diverged.
 */
export interface ScenarioDiff {
  readonly id: string;
  readonly targetedWeakness: string;
  readonly closingCommit: string;
  readonly description: string;
  readonly fieldDiffs: readonly FieldDiff[];
}

export interface FieldDiff {
  /** Dot-path within Tier1ScenarioOutcome (e.g. "iterations" or "customAssertions.iter1Terminal"). */
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
}
