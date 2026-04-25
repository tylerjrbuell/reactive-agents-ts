#!/usr/bin/env bun
// scripts/gate-explain.ts
//
// Dump a full failing trace + outcome for one scenario. Designed for
// harness-improvement-loop sessions investigating a regression: gives
// the AI agent everything it needs to diagnose without re-running.
//
// Usage:
//   bun run gate:explain <scenario-id>
//   bun run gate:explain cf-04-goal-achieved-from-end-turn

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runScenario } from "../packages/testing/src/harness/scenario.js";
import { captureOutcome, REGRESSIONS_DIR } from "../packages/testing/src/gate/runner.js";
import { discoverScenarios } from "../packages/testing/src/gate/registry.js";

const id = process.argv[2];
if (!id) {
  console.error("Usage: bun run gate:explain <scenario-id>");
  process.exit(2);
}

const scenarios = await discoverScenarios();
const scenario = scenarios.find((s) => s.id === id);
if (!scenario) {
  console.error(`No scenario with id "${id}". Known ids:`);
  for (const s of scenarios) console.error(`  ${s.id}  (${s.targetedWeakness})`);
  process.exit(2);
}

console.log(`──── ${scenario.id} ────`);
console.log(`Targeted weakness : ${scenario.targetedWeakness}`);
console.log(`Closing commit    : ${scenario.closingCommit}`);
console.log(`Description       : ${scenario.description}`);
console.log(``);

// Surface the most-recent archived trace for this scenario, if any —
// gives the improvement-loop session the actual failure trace, not a
// fresh re-run that may not reproduce.
if (existsSync(REGRESSIONS_DIR)) {
  const archived = readdirSync(REGRESSIONS_DIR)
    .filter((f) => f.startsWith(`${id}-`) && f.endsWith(".jsonl"))
    .sort()
    .reverse();
  if (archived.length > 0) {
    const latest = join(REGRESSIONS_DIR, archived[0]!);
    console.log(`Most recent archived failing trace:`);
    console.log(`  ${latest}`);
    console.log(``);
    const lines = readFileSync(latest, "utf-8").trim().split("\n");
    console.log(`Trace contains ${lines.length} events. First 5 + last 5:`);
    for (const line of lines.slice(0, 5)) console.log(`  ${line}`);
    if (lines.length > 10) console.log(`  ...`);
    for (const line of lines.slice(-5)) console.log(`  ${line}`);
    console.log(``);
  }
}

console.log(`Running scenario fresh to capture current outcome…`);
const result = await runScenario(scenario.config);
const outcome = captureOutcome(scenario, result);
console.log(``);
console.log(`Current outcome:`);
console.log(JSON.stringify(outcome, null, 2));
