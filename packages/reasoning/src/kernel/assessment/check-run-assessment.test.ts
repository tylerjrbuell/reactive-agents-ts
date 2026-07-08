// check-run-assessment.test.ts — E2 enforcement wiring.
//
// The RunAssessment single-home invariant (no private run-progress counter
// maintained outside kernel/assessment/, save the grandfathered legacy sites) is
// enforced by scripts/check-run-assessment.sh. Run it for real and assert it
// passes — a NEW scattered streak/count/threshold counter turns this RED.
// Mirrors m9-termination-oracle.test.ts's check-termination-paths.sh wiring.

import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

describe("check-run-assessment.sh — RunAssessment single-home invariant", () => {
  it("passes: private run-progress counters confined to the assessment home + grandfathered sites", () => {
    const repoRoot = resolve(import.meta.dir, "..", "..", "..", "..", "..");
    const proc = Bun.spawnSync(["bash", "scripts/check-run-assessment.sh"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("RunAssessment invariant holds");
    expect(proc.exitCode).toBe(0);
  });
});
