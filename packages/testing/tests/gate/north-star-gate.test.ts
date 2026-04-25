// Run: bun test packages/testing/tests/gate/north-star-gate.test.ts --timeout 60000
//
// North Star Test Gate — Tier 1 control-flow regression test.
// Spec: docs/superpowers/specs/2026-04-25-north-star-test-gate.md
//
// This test runs every auto-discovered scenario under
// `packages/testing/src/gate/scenarios/cf-*.ts`, captures Tier1ScenarioOutcomes,
// and diffs against the committed baseline at
// `harness-reports/integration-control-flow-baseline.json`. Any divergence
// fails CI with an actionable failure message.
//
// On first run (no baseline): test snapshots the current outcomes as the
// initial baseline and PASSES. Subsequent runs assert exact equality.
//
// To regenerate the baseline after an intentional change:
//   bun run scripts/gate-update.ts
// The commit message MUST include `BASELINE-UPDATE: <reason>`.

import { describe, it, expect } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import {
  runGate,
  formatFailure,
  readBaseline,
  writeBaseline,
  readHealth,
  writeHealth,
  bumpHealth,
  BASELINE_PATH,
  HEALTH_PATH,
} from "../../src/gate/runner.js";
import { discoverScenarios } from "../../src/gate/registry.js";
import type { Tier1Baseline } from "../../src/gate/types.js";

describe("North Star Test Gate (Tier 1)", () => {
  it(
    "no scenario regressions vs committed baseline",
    async () => {
      const scenarios = await discoverScenarios();
      expect(scenarios.length).toBeGreaterThan(0);

      const result = await runGate();
      const regressedIds = new Set(result.diffs.map((d) => d.id));

      // First-run / bootstrap path: no baseline committed yet → snapshot it.
      // The commit that lands the gate test also lands the initial baseline.
      // Subsequent CI runs assert deep-equality.
      const existing = readBaseline();
      if (existing === null) {
        const fresh: Tier1Baseline = {
          schemaVersion: 1,
          capturedAt: new Date().toISOString(),
          bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
          scenarios: result.outcomes,
        };
        writeBaseline(fresh);
        writeHealth(bumpHealth(readHealth(), scenarios, regressedIds));
        // No assertion to run — first execution always succeeds with the
        // newly-captured baseline. Health sidecar initialized.
        expect(existsSync(BASELINE_PATH)).toBe(true);
        expect(existsSync(HEALTH_PATH)).toBe(true);
        return;
      }

      // Update health sidecar regardless of pass/fail — the harness
      // improvement loop wants execution counts even on green runs.
      writeHealth(bumpHealth(readHealth(), scenarios, regressedIds));

      if (result.diffs.length > 0) {
        const message = formatFailure(result.diffs);
        // Print to stderr so the message is preserved in CI logs.
        process.stderr.write(message);
        // Then fail the test with the same content.
        throw new Error(message);
      }

      expect(result.diffs).toEqual([]);
    },
    60000,
  );
});
