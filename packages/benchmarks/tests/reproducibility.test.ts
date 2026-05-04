// Run: bun test packages/benchmarks/tests/reproducibility.test.ts --timeout 15000
//
// Phase 0 Task 10 — SessionReport reproducibility metadata.
//
// Per docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4 + post-2025 reproducibility
// crisis literature: published bench numbers MUST include enough metadata to
// replay the run. Every SessionReport carries:
//   - judgeModelSha (from judge-server /version)
//   - judgeCodeSha  (from judge-server /version)
//   - runId         (unique per runSession invocation)
//   - replayCommand (exact bash command to re-run this session)
import { describe, it, expect, afterAll } from "bun:test";
import type { ServerHandle } from "@reactive-agents/judge-server";
import type { BenchmarkSession } from "../src/types.js";

let server: ServerHandle | undefined;

afterAll(async () => {
  await server?.stop(true);
});

const SUT_MODEL_ID = "claude-sonnet-4-6";

function buildMinimalSession(judgeUrl: string): BenchmarkSession {
  return {
    id: "repro-test",
    name: "Reproducibility metadata test",
    version: "1",
    // Empty filter yields zero tasks; runSession still produces a SessionReport
    // with reproducibility metadata populated from /version.
    taskIds: ["__nonexistent__"],
    models: [
      {
        id: "sut-variant",
        provider: "anthropic",
        model: SUT_MODEL_ID,
        contextTier: "frontier",
      },
    ],
    harnessVariants: [],
    runs: 1,
    timeoutMs: 5_000,
    logLevel: "silent",
    judgeUrl,
  };
}

describe("SessionReport reproducibility metadata (Task 10)", () => {
  it("populates judgeModelSha, judgeCodeSha, runId, replayCommand in SessionReport", async () => {
    const { startServer } = await import("@reactive-agents/judge-server");
    server = await startServer({
      port: 0,
      judgeModelSha: "judge-sha-abc",
      judgeCodeSha: "judge-code-def",
      judgeLayer: "stub",
    });
    const judgeUrl = `http://127.0.0.1:${server.port}`;

    const { runSession } = await import("../src/runner.js");
    const report = await runSession(buildMinimalSession(judgeUrl));

    expect(report.reproducibility).toBeDefined();
    expect(report.reproducibility.judgeModelSha).toBe("judge-sha-abc");
    expect(report.reproducibility.judgeCodeSha).toBe("judge-code-def");
    expect(report.reproducibility.runId).toMatch(/^run-/);
    expect(report.reproducibility.replayCommand).toContain("--run-id");
    expect(report.reproducibility.replayCommand).toContain(report.reproducibility.runId);
    expect(report.reproducibility.replayCommand).toContain("repro-test");
  }, 15000);

  it("populates degraded reproducibility metadata when no judge URL configured", async () => {
    const { runSession } = await import("../src/runner.js");
    const prevJudgeUrl = process.env.JUDGE_URL;
    delete process.env.JUDGE_URL;
    try {
      const session: BenchmarkSession = {
        id: "repro-test-no-judge",
        name: "Reproducibility metadata (no judge)",
        version: "1",
        taskIds: ["__nonexistent__"],
        models: [
          {
            id: "sut-variant",
            provider: "anthropic",
            model: SUT_MODEL_ID,
            contextTier: "frontier",
          },
        ],
        harnessVariants: [],
        runs: 1,
        timeoutMs: 5_000,
        logLevel: "silent",
      };
      const report = await runSession(session);
      expect(report.reproducibility).toBeDefined();
      expect(report.reproducibility.judgeModelSha).toBe("unknown-no-judge-configured");
      expect(report.reproducibility.judgeCodeSha).toBe("unknown-no-judge-configured");
      expect(report.reproducibility.runId).toMatch(/^run-/);
      expect(report.reproducibility.replayCommand).toContain("--run-id");
    } finally {
      if (prevJudgeUrl !== undefined) process.env.JUDGE_URL = prevJudgeUrl;
    }
  }, 15000);

  it("generates a distinct runId on each runSession invocation", async () => {
    // Regression guard: if someone makes runId deterministic from session.id
    // (e.g. for "stable" run identifiers), every replay would fragment to the
    // same id and downstream tracing would collapse. Two back-to-back runs
    // MUST produce different runIds.
    const prevJudgeUrl = process.env.JUDGE_URL;
    delete process.env.JUDGE_URL;
    try {
      const { runSession } = await import("../src/runner.js");
      const session: BenchmarkSession = {
        id: "repro-uniqueness",
        name: "runId uniqueness regression",
        version: "1",
        taskIds: [],
        models: [
          {
            id: "sut-variant",
            provider: "anthropic",
            model: SUT_MODEL_ID,
            contextTier: "frontier",
          },
        ],
        harnessVariants: [],
        runs: 1,
        timeoutMs: 5_000,
        logLevel: "silent",
      };
      const reportA = await runSession(session);
      const reportB = await runSession(session);
      expect(reportA.reproducibility.runId).not.toBe(reportB.reproducibility.runId);
    } finally {
      if (prevJudgeUrl !== undefined) process.env.JUDGE_URL = prevJudgeUrl;
    }
  }, 15000);
});
