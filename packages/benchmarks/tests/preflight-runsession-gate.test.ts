// Run: bun test packages/benchmarks/tests/preflight-runsession-gate.test.ts --timeout 15000
//
// Integration pin for the capability-source preflight gate inside runSession.
// The gate runs after the Rule-4 judge guard and before the task loop: a
// session whose model resolves to source="fallback" MUST be refused, loudly,
// rather than scored. Mirrors rule4-guard.test.ts discipline.
import { describe, it, expect } from "bun:test";
import type { BenchmarkSession } from "../src/types.js";

function buildSession(model: string): BenchmarkSession {
  return {
    id: "preflight-gate-test",
    name: "Preflight gate test",
    version: "1",
    // Nonexistent task id: if the preflight does NOT fire, runSession proceeds
    // and fails later (zero tasks / other). The fallback case asserts the
    // preflight error fires FIRST, before any of that.
    taskIds: ["__nonexistent__"],
    models: [
      {
        id: "sut-variant",
        provider: "ollama",
        model,
      },
    ],
    harnessVariants: [],
    runs: 1,
    timeoutMs: 5_000,
    logLevel: "silent",
  } as BenchmarkSession;
}

describe("capability-source preflight gate (runSession integration)", () => {
  it("refuses to run a session whose model resolves to source=fallback", async () => {
    const { runSession } = await import("../src/runner.js");
    await expect(
      runSession(buildSession("definitely-not-a-real-model-xyz")),
    ).rejects.toThrow(/preflight failed|source="fallback"/);
  }, 15000);

  it("does NOT raise the preflight error for a static-table model", async () => {
    const { runSession } = await import("../src/runner.js");
    let preflightThrown = false;
    try {
      await runSession(buildSession("qwen3:14b")); // static-table — clean source
    } catch (e: unknown) {
      if (e instanceof Error && /preflight failed/.test(e.message)) {
        preflightThrown = true;
      }
      // Other errors (no tasks resolved, etc.) are acceptable for this assertion.
    }
    expect(preflightThrown).toBe(false);
  }, 15000);

  it("allows a fallback-source model through when RA_BENCH_ALLOW_FALLBACK=1", async () => {
    const prev = process.env.RA_BENCH_ALLOW_FALLBACK;
    process.env.RA_BENCH_ALLOW_FALLBACK = "1";
    try {
      const { runSession } = await import("../src/runner.js");
      let preflightThrown = false;
      try {
        await runSession(buildSession("definitely-not-a-real-model-xyz"));
      } catch (e: unknown) {
        if (e instanceof Error && /preflight failed/.test(e.message)) {
          preflightThrown = true;
        }
      }
      expect(preflightThrown).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.RA_BENCH_ALLOW_FALLBACK;
      else process.env.RA_BENCH_ALLOW_FALLBACK = prev;
    }
  }, 15000);
});
