#!/usr/bin/env bun
// scripts/gate-update.ts
//
// Regenerate the Tier 1 baseline. Designed for the harness improvement
// loop: when an intentional behavioral change ships, this script writes
// the fresh baseline AND prompts the user for a `BASELINE-UPDATE:` reason
// that's enforced as a commit-message trailer.
//
// Spec: docs/superpowers/specs/2026-04-25-north-star-test-gate.md §6.5.2
//
// Usage:
//   bun run gate:update                        # interactive
//   bun run gate:update --reason "<reason>"    # non-interactive

import { writeFileSync } from "node:fs";
import {
  runGate,
  writeBaseline,
  writeHealth,
  readHealth,
  bumpHealth,
  BASELINE_PATH,
  HEALTH_PATH,
} from "../packages/testing/src/gate/runner.js";
import { discoverScenarios } from "../packages/testing/src/gate/registry.js";
import type { Tier1Baseline } from "../packages/testing/src/gate/types.js";

const args = process.argv.slice(2);
let reason = "";
const reasonIdx = args.indexOf("--reason");
if (reasonIdx >= 0 && reasonIdx + 1 < args.length) {
  reason = args[reasonIdx + 1]!;
}

if (!reason) {
  // Interactive prompt — blocking read from stdin until newline.
  process.stdout.write(
    "Reason for this baseline update (one line, becomes BASELINE-UPDATE: trailer): ",
  );
  for await (const line of console) {
    reason = line.trim();
    break;
  }
}

if (!reason) {
  process.stderr.write(
    "ERROR: no reason supplied. Refusing to update the baseline silently.\n" +
      "  Re-run with `--reason \"...\"` or provide a reason at the prompt.\n",
  );
  process.exit(1);
}

const scenarios = await discoverScenarios();
console.log(`Running ${scenarios.length} scenarios to capture fresh baseline…`);

const result = await runGate();
const fresh: Tier1Baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
  scenarios: result.outcomes,
};
writeBaseline(fresh);

// Bump baseline-update counters in health sidecar.
const priorHealth = readHealth();
const now = new Date().toISOString();
const updatedHealth = {
  schemaVersion: 1 as const,
  scenarios: Object.fromEntries(
    scenarios.map((s) => {
      const old = priorHealth.scenarios[s.id];
      return [
        s.id,
        {
          executions: old?.executions ?? 0,
          lastExecutedAt: old?.lastExecutedAt ?? now,
          regressionsCaught: old?.regressionsCaught ?? 0,
          lastRegressionAt: old?.lastRegressionAt ?? null,
          baselineUpdatedAt: now,
          baselineUpdateCount: (old?.baselineUpdateCount ?? 0) + 1,
          targetedWeakness: s.targetedWeakness,
        },
      ];
    }),
  ),
};
writeHealth(updatedHealth);

// Stash the reason in a file the commit-message lint reads.
writeFileSync(".gate-baseline-reason", reason + "\n", "utf-8");

console.log(``);
console.log(`✓ Wrote ${BASELINE_PATH}`);
console.log(`✓ Wrote ${HEALTH_PATH}`);
console.log(`✓ Reason stashed in .gate-baseline-reason`);
console.log(``);
console.log(`Commit using:`);
console.log(`  git commit -m "<your subject>" -m "BASELINE-UPDATE: ${reason}"`);
