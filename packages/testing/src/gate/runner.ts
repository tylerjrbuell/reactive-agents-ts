// packages/testing/src/gate/runner.ts
//
// Tier-1 gate runner. Discovers scenarios via the registry, executes each
// using `runScenario`, captures a Tier1ScenarioOutcome, and writes the
// aggregate Tier1Baseline to `harness-reports/integration-control-flow-baseline.json`.
//
// Designed for the harness improvement loop:
//   - Failure path archives the offending trace under `harness-reports/regressions/`
//     so the next session has a frozen snapshot to analyze.
//   - Health sidecar updates increment executions/regressionsCaught.
//   - Coverage report (weakness → scenarios) surfaces uncovered weaknesses
//     and redundancy.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { runScenario } from "../harness/scenario.js";
import type { ScenarioResult } from "../harness/scenario.js";
import type {
  ScenarioModule,
  ScenarioDiff,
  FieldDiff,
  Tier1Baseline,
  Tier1ScenarioOutcome,
  ScenarioHealth,
  ScenarioHealthEntry,
} from "./types.js";
import { discoverScenarios, summarizeCoverage } from "./registry.js";

// ─── Filesystem layout ────────────────────────────────────────────────────────

export const REPORTS_DIR = "harness-reports";
export const BASELINE_PATH = join(REPORTS_DIR, "integration-control-flow-baseline.json");
export const HEALTH_PATH = join(REPORTS_DIR, "integration-control-flow-scenario-health.json");
export const REGRESSIONS_DIR = join(REPORTS_DIR, "regressions");
export const TRACES_DIR = join(REPORTS_DIR, "gate-traces");

// ─── Outcome capture ──────────────────────────────────────────────────────────

const KNOWN_TERMINATED_BY: ReadonlySet<Tier1ScenarioOutcome["terminatedBy"]> = new Set([
  "final_answer_tool",
  "final_answer",
  "max_iterations",
  "end_turn",
  "llm_error",
  "unknown",
]);

/**
 * Convert a ScenarioResult (trace + output) into a Tier1ScenarioOutcome.
 * Pure function — same trace yields same outcome — so the gate's diff is
 * stable across re-runs.
 */
export function captureOutcome(
  scenario: ScenarioModule,
  result: ScenarioResult,
): Tier1ScenarioOutcome {
  const events = result.trace.events;

  const completed = events.find((e) => e.kind === "run-completed") as
    | { kind: "run-completed"; status: "success" | "failure"; iterations?: number; terminatedBy?: string }
    | undefined;

  const status: "success" | "failure" = completed?.status ?? "failure";

  // Iterations: prefer explicit run-completed field, fall back to entropy events.
  const entropyIters = events
    .filter((e) => e.kind === "entropy-scored")
    .map((e) => (e as { iter: number }).iter);
  const iterations =
    typeof completed?.iterations === "number"
      ? completed.iterations
      : entropyIters.length > 0
        ? Math.max(...entropyIters) + 1
        : 0;

  const rawTerminatedBy = completed?.terminatedBy ?? "unknown";
  const terminatedBy = (KNOWN_TERMINATED_BY.has(
    rawTerminatedBy as Tier1ScenarioOutcome["terminatedBy"],
  )
    ? rawTerminatedBy
    : "unknown") as Tier1ScenarioOutcome["terminatedBy"];

  const goalAchieved: boolean | null = (() => {
    switch (terminatedBy) {
      case "final_answer_tool":
      case "final_answer":
        return true;
      case "max_iterations":
      case "llm_error":
        return false;
      case "end_turn":
      case "unknown":
        return null;
    }
  })();

  const toolCallsObserved = sortedUnique(
    events
      .filter((e) => e.kind === "tool-call-end")
      .map((e) => (e as { toolName: string }).toolName),
  );

  const interventionsDispatched = sortedUnique(
    events
      .filter((e) => e.kind === "intervention-dispatched")
      .map((e) => (e as { decisionType: string }).decisionType),
  );

  const errorSwallowedSites = sortedUnique(
    events
      .filter((e) => (e as { kind: string }).kind === "error-swallowed")
      .map((e) => (e as { site?: string }).site ?? "unknown"),
  );

  const redactorsTriggered = sortedUnique(
    events
      .filter((e) => (e as { kind: string }).kind === "redaction-applied")
      .map((e) => (e as { redactorName?: string }).redactorName ?? "unknown"),
  );

  const customAssertions = scenario.customAssertions
    ? scenario.customAssertions(result)
    : {};

  return {
    status,
    iterations,
    terminatedBy,
    goalAchieved,
    toolCallsObserved,
    interventionsDispatched,
    errorSwallowedSites,
    redactorsTriggered,
    customAssertions,
  };
}

function sortedUnique(xs: readonly string[]): readonly string[] {
  return [...new Set(xs)].sort();
}

// ─── Baseline I/O ─────────────────────────────────────────────────────────────

export function readBaseline(): Tier1Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  const raw = readFileSync(BASELINE_PATH, "utf-8");
  return JSON.parse(raw) as Tier1Baseline;
}

export function writeBaseline(baseline: Tier1Baseline): void {
  ensureDir(REPORTS_DIR);
  // Sort scenarios alphabetically so JSON diffs are stable across runs.
  const sorted: Tier1Baseline = {
    ...baseline,
    scenarios: Object.fromEntries(
      Object.entries(baseline.scenarios).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

// ─── Diff (§2.4) ──────────────────────────────────────────────────────────────

/**
 * Compare a fresh outcome against the baseline outcome for the same scenario.
 * Returns null when they match exactly (stable mocked LLM = deterministic).
 */
export function diffOutcomes(
  scenario: ScenarioModule,
  expected: Tier1ScenarioOutcome,
  actual: Tier1ScenarioOutcome,
): ScenarioDiff | null {
  const fieldDiffs: FieldDiff[] = [];

  for (const key of [
    "status",
    "iterations",
    "terminatedBy",
    "goalAchieved",
  ] as const) {
    if (expected[key] !== actual[key]) {
      fieldDiffs.push({ path: key, expected: expected[key], actual: actual[key] });
    }
  }

  for (const key of [
    "toolCallsObserved",
    "interventionsDispatched",
    "errorSwallowedSites",
    "redactorsTriggered",
  ] as const) {
    if (!arrayEqual(expected[key], actual[key])) {
      fieldDiffs.push({ path: key, expected: expected[key], actual: actual[key] });
    }
  }

  // Custom assertions diff (any field added, removed, or changed).
  const allCustomKeys = new Set([
    ...Object.keys(expected.customAssertions),
    ...Object.keys(actual.customAssertions),
  ]);
  for (const k of allCustomKeys) {
    if (expected.customAssertions[k] !== actual.customAssertions[k]) {
      fieldDiffs.push({
        path: `customAssertions.${k}`,
        expected: expected.customAssertions[k],
        actual: actual.customAssertions[k],
      });
    }
  }

  if (fieldDiffs.length === 0) return null;
  return {
    id: scenario.id,
    targetedWeakness: scenario.targetedWeakness,
    closingCommit: scenario.closingCommit,
    description: scenario.description,
    fieldDiffs,
  };
}

function arrayEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─── Failure message (improvement-loop-aware) ─────────────────────────────────

/**
 * Render a failure summary that points the reader to the original fix and
 * the recovery actions. Designed for harness-improvement-loop sessions:
 * instead of "expected X got Y", the message names the weakness ID, the
 * commit that closed the gap, and the exact next-step commands.
 */
export function formatFailure(diffs: readonly ScenarioDiff[]): string {
  const lines: string[] = [];
  lines.push(
    `\n❌ North Star Test Gate (Tier 1) — ${diffs.length} regression${diffs.length === 1 ? "" : "s"} detected\n`,
  );
  for (const d of diffs) {
    lines.push(`──── ${d.id} ────`);
    lines.push(`  Targeted weakness : ${d.targetedWeakness}`);
    lines.push(`  Closing commit    : ${d.closingCommit}`);
    lines.push(`  Description       : ${d.description}`);
    lines.push(`  Diverged fields:`);
    for (const f of d.fieldDiffs) {
      lines.push(
        `    • ${f.path}\n      expected: ${JSON.stringify(f.expected)}\n      actual  : ${JSON.stringify(f.actual)}`,
      );
    }
    lines.push("");
  }
  lines.push(`Next steps:`);
  lines.push(`  1. If the regression is unintentional, inspect the closing commit(s) above`);
  lines.push(`     and the scenario file at packages/testing/src/gate/scenarios/<id>.ts`);
  lines.push(`  2. To dump the failing trace for one scenario:`);
  lines.push(`     bun run gate:explain <id>`);
  lines.push(`  3. If the change is intentional, regenerate the baseline:`);
  lines.push(`     bun run gate:update`);
  lines.push(`     (the script prompts for a BASELINE-UPDATE: reason and writes the trailer)`);
  lines.push(``);
  lines.push(`Failing traces archived under ${REGRESSIONS_DIR}/ for postmortem.`);
  return lines.join("\n");
}

// ─── Trace archival on regression (improvement-loop primitive) ────────────────

/**
 * When the gate fails, copy the failing scenario's JSONL trace to
 * `harness-reports/regressions/<id>-<iso>.jsonl`. The improvement-loop
 * session can read these directly without re-running the agent.
 */
export function archiveFailingTrace(
  scenarioId: string,
  sourceTracePath: string,
): string {
  ensureDir(REGRESSIONS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(REGRESSIONS_DIR, `${scenarioId}-${stamp}.jsonl`);
  copyFileSync(sourceTracePath, dest);
  return dest;
}

// ─── Health sidecar (§6.5.3) ──────────────────────────────────────────────────

export function readHealth(): ScenarioHealth {
  if (!existsSync(HEALTH_PATH)) {
    return { schemaVersion: 1, scenarios: {} };
  }
  return JSON.parse(readFileSync(HEALTH_PATH, "utf-8")) as ScenarioHealth;
}

export function writeHealth(health: ScenarioHealth): void {
  ensureDir(REPORTS_DIR);
  const sorted: ScenarioHealth = {
    ...health,
    scenarios: Object.fromEntries(
      Object.entries(health.scenarios).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  writeFileSync(HEALTH_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf-8");
}

/**
 * Increment per-scenario execution and (optionally) regression counters.
 * Called once per gate run — preserves prior state for scenarios that
 * existed before but no longer do (lets the improvement loop see retired
 * scenarios in the health log).
 */
export function bumpHealth(
  prior: ScenarioHealth,
  scenarios: readonly ScenarioModule[],
  regressedIds: ReadonlySet<string>,
): ScenarioHealth {
  const now = new Date().toISOString();
  const next: Record<string, ScenarioHealthEntry> = { ...prior.scenarios };
  for (const s of scenarios) {
    const old = next[s.id];
    next[s.id] = {
      executions: (old?.executions ?? 0) + 1,
      lastExecutedAt: now,
      regressionsCaught: (old?.regressionsCaught ?? 0) + (regressedIds.has(s.id) ? 1 : 0),
      lastRegressionAt: regressedIds.has(s.id) ? now : (old?.lastRegressionAt ?? null),
      baselineUpdatedAt: old?.baselineUpdatedAt ?? now,
      baselineUpdateCount: old?.baselineUpdateCount ?? 0,
      targetedWeakness: s.targetedWeakness,
    };
  }
  return { schemaVersion: 1, scenarios: next };
}

// ─── Top-level runner ─────────────────────────────────────────────────────────

export interface GateRunResult {
  readonly outcomes: Record<string, Tier1ScenarioOutcome>;
  readonly diffs: readonly ScenarioDiff[];
  readonly archivedTraces: Record<string, string>;
  readonly coverage: ReturnType<typeof summarizeCoverage>;
}

/**
 * Run every discovered scenario, capture outcomes, and (when a baseline
 * exists) compute diffs. Does NOT write any files — that's the caller's
 * job (the gate test, or the gate:update CLI).
 */
export async function runGate(): Promise<GateRunResult> {
  const scenarios = await discoverScenarios();
  const baseline = readBaseline();
  const outcomes: Record<string, Tier1ScenarioOutcome> = {};
  const diffs: ScenarioDiff[] = [];
  const archivedTraces: Record<string, string> = {};

  ensureDir(TRACES_DIR);

  for (const s of scenarios) {
    const config = {
      ...s.config,
      tracingDir: s.config.tracingDir ?? join(TRACES_DIR, s.id),
    };
    const result = await runScenario(config);
    const outcome = captureOutcome(s, result);
    outcomes[s.id] = outcome;

    if (baseline?.scenarios[s.id]) {
      const diff = diffOutcomes(s, baseline.scenarios[s.id]!, outcome);
      if (diff) {
        diffs.push(diff);
        const traceFile = join(config.tracingDir!, `${result.runId}.jsonl`);
        if (existsSync(traceFile)) {
          archivedTraces[s.id] = archiveFailingTrace(s.id, traceFile);
        }
      }
    }
  }

  const coverage = summarizeCoverage(scenarios);
  return { outcomes, diffs, archivedTraces, coverage };
}
