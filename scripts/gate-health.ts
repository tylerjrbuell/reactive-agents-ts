#!/usr/bin/env bun
// scripts/gate-health.ts
//
// Print the scenario-health table: which scenarios are earning their
// place, which are stale, which are unstable. Designed for harness-
// improvement-loop sessions to surface retirement and reinforcement
// candidates.
//
// Spec: docs/superpowers/specs/2026-04-25-north-star-test-gate.md §6.5.3
//
// Usage:
//   bun run gate:health

import { readHealth } from "../packages/testing/src/gate/runner.js";
import { discoverScenarios, summarizeCoverage } from "../packages/testing/src/gate/registry.js";

const STALE_DAYS = 90;
const HIGH_CHURN = 5;

const health = readHealth();
const scenarios = await discoverScenarios();
const { coverage, redundancy } = summarizeCoverage(scenarios);
const now = Date.now();

const rows = scenarios.map((s) => {
  const h = health.scenarios[s.id];
  const lastReg = h?.lastRegressionAt ? Date.parse(h.lastRegressionAt) : null;
  const daysSinceReg = lastReg ? Math.floor((now - lastReg) / 86_400_000) : null;
  return {
    id: s.id,
    weakness: s.targetedWeakness,
    executions: h?.executions ?? 0,
    regressionsCaught: h?.regressionsCaught ?? 0,
    daysSinceReg,
    baselineChurn: h?.baselineUpdateCount ?? 0,
  };
});

console.log("Scenario health table");
console.log("═".repeat(110));
console.log(
  `${"id".padEnd(45)} ${"weakness".padEnd(18)} ${"runs".padStart(6)} ${"caught".padStart(7)} ${"daysAgo".padStart(8)} ${"churn".padStart(6)} ${"flag".padStart(12)}`,
);
console.log("─".repeat(110));
for (const r of rows) {
  const flag =
    r.executions === 0
      ? "NEVER-RUN"
      : r.regressionsCaught === 0 && r.daysSinceReg === null && r.executions >= 5
        ? "stale?"
        : r.daysSinceReg !== null && r.daysSinceReg > STALE_DAYS
          ? "stale"
          : r.baselineChurn >= HIGH_CHURN
            ? "high-churn"
            : "ok";
  console.log(
    `${r.id.padEnd(45)} ${r.weakness.padEnd(18)} ${String(r.executions).padStart(6)} ${String(r.regressionsCaught).padStart(7)} ${String(r.daysSinceReg ?? "—").padStart(8)} ${String(r.baselineChurn).padStart(6)} ${flag.padStart(12)}`,
  );
}
console.log(``);

console.log(`Coverage by weakness (${Object.keys(coverage).length} unique weaknesses):`);
for (const [weakness, ids] of Object.entries(coverage).sort()) {
  console.log(`  ${weakness.padEnd(18)} ${ids.length}× → ${ids.join(", ")}`);
}

if (redundancy.length > 0) {
  console.log(``);
  console.log(`⚠ Multiple scenarios targeting the same weakness (consider consolidation):`);
  for (const w of redundancy) console.log(`    ${w}: ${coverage[w]!.join(", ")}`);
}

console.log(``);
console.log(`Tip: cross-reference with harness-reports/loop-state.json knownWeaknesses to find gaps.`);
