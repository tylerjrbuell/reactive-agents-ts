#!/usr/bin/env bun
// scripts/gate-propose.ts
//
// Cross-reference loop-state.json weaknesses against gate scenario
// coverage and emit scaffold scenario files for any uncovered weakness.
//
// Spec: docs/superpowers/specs/2026-04-25-north-star-test-gate.md §6.5.5
//
// Designed for harness-improvement-loop sessions: instead of manually
// deciding "which weaknesses don't have a scenario yet?", this script
// produces the answer + concrete next-step files.
//
// Usage:
//   bun run gate:propose                       # report only, no writes
//   bun run gate:propose --emit                # write scaffold files for uncovered weaknesses

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverScenarios, summarizeCoverage } from "../packages/testing/src/gate/registry.js";

const LOOP_STATE_PATH = "harness-reports/loop-state.json";
const SCENARIOS_DIR = "packages/testing/src/gate/scenarios";

interface LoopStateWeakness {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly severity?: string;
  readonly status?: string;
}

interface LoopState {
  readonly knownWeaknesses?: readonly LoopStateWeakness[];
}

const emit = process.argv.includes("--emit");

if (!existsSync(LOOP_STATE_PATH)) {
  console.error(`No loop-state at ${LOOP_STATE_PATH}; nothing to cross-reference.`);
  process.exit(0);
}

const loopState = JSON.parse(readFileSync(LOOP_STATE_PATH, "utf-8")) as LoopState;
const weaknesses = loopState.knownWeaknesses ?? [];
const scenarios = await discoverScenarios();
const { coverage } = summarizeCoverage(scenarios);

// Build a map: weakness ID prefix → covered?
const coveredKeys = new Set(Object.keys(coverage));
const uncovered: LoopStateWeakness[] = [];
for (const w of weaknesses) {
  const isOpen = w.status !== "fixed" && w.status !== "resolved";
  if (!isOpen) continue;
  // A weakness is covered if any scenario's targetedWeakness contains its id
  const covered = [...coveredKeys].some((k) => k.includes(w.id));
  if (!covered) uncovered.push(w);
}

console.log(`Loop-state has ${weaknesses.length} weaknesses; ${uncovered.length} open + uncovered by gate scenarios.`);
console.log(``);

if (uncovered.length === 0) {
  console.log(`✓ All open weaknesses have at least one scenario.`);
  process.exit(0);
}

for (const w of uncovered) {
  console.log(`──── ${w.id} ────`);
  console.log(`  Title       : ${w.title ?? "(no title)"}`);
  console.log(`  Severity    : ${w.severity ?? "(unknown)"}`);
  console.log(`  Description : ${w.description ?? "(no description)"}`);
  if (emit) {
    const slug = (w.title ?? w.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const fileId = `cf-TODO-${w.id.toLowerCase()}-${slug}`;
    const path = join(SCENARIOS_DIR, `${fileId}.ts`);
    if (existsSync(path)) {
      console.log(`  → scaffold already exists at ${path}`);
      continue;
    }
    const scaffold = `// ${path}
//
// TODO: implement scenario covering weakness ${w.id}.
// Title: ${w.title ?? "(no title)"}
// Description: ${w.description ?? "(no description)"}
//
// Replace this scaffold with a real ScenarioModule and rename the file
// from cf-TODO-* to cf-NN-* (next sequential number).

import type { ScenarioModule } from "../types.js";

export const scenario: ScenarioModule = {
  id: "${fileId}",
  targetedWeakness: "${w.id}",
  closingCommit: "TODO",
  description:
    "TODO: ${(w.description ?? w.title ?? "no description").replace(/"/g, '\\"').slice(0, 200)}",
  config: {
    name: "${fileId}",
    task: "TODO",
    testTurns: [{ text: "TODO" }],
    maxIterations: 5,
  },
};
`;
    writeFileSync(path, scaffold, "utf-8");
    console.log(`  → wrote scaffold to ${path}`);
  } else {
    console.log(`  (run with --emit to write a scaffold scenario file)`);
  }
}

if (!emit) {
  console.log(``);
  console.log(`Re-run with --emit to write scaffold files (cf-TODO-*) for these weaknesses.`);
}
