// Run: bun test packages/benchmarks/tests/reliability-session.test.ts
//
// pass^8 needs a producer: pass^k shipped with honest-absence (no estimate when
// n < k), but NO registered session ran n ≥ 8 — so pass^8 was structurally
// absent from every report. This file pins the reliability session as that
// producer: n = 8 per cell, graded deterministic tasks only, and actually
// registered in the CLI session registry (a session no CLI can start is a
// decoration).

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reliabilitySession } from "../src/sessions/reliability.js";
import { PASS_K_VALUES } from "../src/report-format.js";
import { ALL_TASKS } from "../src/runner.js";

describe("reliability session (pass^8 producer)", () => {
  it("runs n ≥ 8 per cell so pass^8 is computable (max PASS_K_VALUES k)", () => {
    const maxK = Math.max(...PASS_K_VALUES);
    expect(maxK).toBe(8);
    expect(reliabilitySession.runs ?? 1).toBeGreaterThanOrEqual(maxK);
  });

  it("selects only graded deterministic tasks (verifiable + partialCredit), and they exist", () => {
    const ids = reliabilitySession.taskIds ?? [];
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      const task = ALL_TASKS.find((t) => t.id === id);
      expect(task).toBeDefined();
      // Deterministic graded scoring — pass^8 must measure the model/harness's
      // run-to-run variance, not an LLM judge's Bernoulli noise.
      expect(task!.successCriteria?.type).toBe("verifiable");
      if (task!.successCriteria?.type === "verifiable") {
        expect(task!.successCriteria.partialCredit).toBe(true);
      }
    }
  });

  it("is registered in the CLI session registry (src/run.ts SESSIONS)", () => {
    // run.ts executes main() on import, so registration is pinned via source
    // text, not an import. Cutting the registry line fails this test.
    const src = readFileSync(join(import.meta.dir, "..", "src", "run.ts"), "utf8");
    expect(src).toMatch(/"reliability":\s*reliabilitySession/);
    expect(src).toMatch(/from "\.\/sessions\/reliability\.js"/);
  });
});
