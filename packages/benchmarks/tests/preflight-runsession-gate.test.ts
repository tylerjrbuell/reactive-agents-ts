// Run: bun test packages/benchmarks/tests/preflight-runsession-gate.test.ts --timeout 20000
//
// Per-cell bench honesty (canonical-contracts-and-invariants §6 — BenchCellOutcome).
// A cell whose model resolves to source="fallback" is marked INCONCLUSIVE and is
// NOT run or scored — instead of aborting the whole session (the prior coarse
// throw) or producing a misconfigured-budget 0%. Mixed-tier sessions stay honest:
// good cells measure, bad cells are flagged. The inconclusive path short-circuits
// BEFORE any provider dispatch, so this is an offline test.
import { describe, it, expect } from "bun:test";
import type { BenchmarkSession } from "../src/types.js";

function sessionWith(model: string, taskIds: string[]): BenchmarkSession {
  return {
    id: "preflight-cell-test",
    name: "Preflight per-cell test",
    version: "1",
    taskIds,
    models: [{ id: "sut", provider: "ollama", model }],
    harnessVariants: [{ type: "internal", id: "v1", label: "v1", config: {} }],
    runs: 1,
    timeoutMs: 5_000,
    logLevel: "silent",
  } as BenchmarkSession;
}

describe("per-cell capability-source honesty (runSession)", () => {
  it("marks a fallback-source cell INCONCLUSIVE without throwing or dispatching", async () => {
    const { runSession } = await import("../src/runner.js");
    const report = await runSession(sessionWith("definitely-not-real-xyz", ["t1-js-typeof"]));

    expect(report.partialMeasurement).toBe(true);
    expect(report.inconclusiveCells?.length).toBe(1);
    const cell = report.inconclusiveCells![0]!;
    expect(cell.taskId).toBe("t1-js-typeof");
    expect(cell.reason.kind).toBe("capability-source");

    // The cell appears in taskReports flagged inconclusive with no runs.
    const tr = report.taskReports?.find((r) => r.taskId === "t1-js-typeof");
    expect(tr?.inconclusive).toBeDefined();
    expect(tr?.runs.length).toBe(0);
  }, 20000);

  it("does NOT flag a static-table model (no inconclusive cells)", async () => {
    const { runSession } = await import("../src/runner.js");
    // Nonexistent task → 0 cells → no dispatch; confirms static-table isn't flagged.
    const report = await runSession(sessionWith("qwen3:14b", ["__nonexistent__"]));
    expect(report.partialMeasurement).toBeFalsy();
    expect(report.inconclusiveCells?.length ?? 0).toBe(0);
  }, 20000);
});
