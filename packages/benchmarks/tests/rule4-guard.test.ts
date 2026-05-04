// Run: bun test packages/benchmarks/tests/rule4-guard.test.ts --timeout 15000
//
// Phase 0 Task 9 — Rule-4 guard.
//
// Per docs/spec/docs/00-RESEARCH-DISCIPLINE.md Rule 4, the judge model MUST be
// a separately-versioned, model-pinned artifact distinct from the System Under
// Test. Self-evaluation produces inflated scores via self-preference bias
// (arXiv:2410.21819). This test pins the contract: `runSession` MUST refuse to
// run when the judge-server's `/version` endpoint reports `judgeModelSha ===
// <SUT model identifier from session.models[i].model>`.
import { describe, it, expect, afterAll } from "bun:test";
import type { ServerHandle } from "@reactive-agents/judge-server";
import type { BenchmarkSession } from "../src/types.js";

let server: ServerHandle | undefined;

afterAll(async () => {
  await server?.stop(true);
});

const SUT_MODEL_ID = "claude-sonnet-4-6";

function buildMinimalSession(judgeUrl: string): BenchmarkSession & { readonly judgeUrl: string } {
  return {
    id: "rule4-guard-test",
    name: "Rule-4 guard test",
    version: "1",
    // Empty taskIds + matching empty registry filter would yield zero tasks; we want
    // the guard to fire BEFORE task execution so this is fine — the guard runs at the
    // top of runSession, before any task loop.
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
  } as BenchmarkSession & { readonly judgeUrl: string };
}

describe("Rule-4 guard (Task 9)", () => {
  it("rejects a bench run when judge model SHA matches SUT model", async () => {
    const { startServer } = await import("@reactive-agents/judge-server");
    server = await startServer({
      port: 0,
      judgeModelSha: SUT_MODEL_ID, // intentionally same as SUT
      judgeCodeSha: "test-code-sha",
      judgeLayer: "stub",
    });
    const judgeUrl = `http://127.0.0.1:${server.port}`;

    const { runSession } = await import("../src/runner.js");
    await expect(runSession(buildMinimalSession(judgeUrl))).rejects.toThrow(/Rule.4/);
  }, 15000);

  it("allows a bench run when judge model SHA differs from SUT model", async () => {
    if (!server) throw new Error("test ordering broken");
    server.stop(true);
    const { startServer } = await import("@reactive-agents/judge-server");
    server = await startServer({
      port: 0,
      judgeModelSha: "claude-haiku-4-5-20251001", // different from SUT
      judgeCodeSha: "test-code-sha",
      judgeLayer: "stub",
    });
    const judgeUrl = `http://127.0.0.1:${server.port}`;

    const { runSession } = await import("../src/runner.js");

    // Smoke test: runSession with mismatched models should NOT throw the Rule-4 error.
    // It might throw something else (no tasks resolved, etc.) — that's fine; this
    // assertion is specifically that the Rule-4 error is not raised.
    let rule4Thrown = false;
    try {
      await runSession(buildMinimalSession(judgeUrl));
    } catch (e: unknown) {
      if (e instanceof Error && /Rule.4/.test(e.message)) {
        rule4Thrown = true;
      }
      // Other errors are acceptable for this assertion.
    }
    expect(rule4Thrown).toBe(false);
  }, 15000);
});
