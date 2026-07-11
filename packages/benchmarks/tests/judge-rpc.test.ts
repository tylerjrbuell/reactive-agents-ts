// Run: bun test packages/benchmarks/tests/judge-rpc.test.ts --timeout 15000
//
// Task 8: prove that bench scoreTask routes its accuracy "llm-judge" path through
// a judge-server RPC instead of constructing an in-process agent. We start the
// stub layer (no live provider boot), then call scoreTask with a task that has
// successCriteria.type === "llm-judge" and assert the result reflects the stub
// verdict (passed / overallScore: 0.95).
import { describe, it, expect, afterAll } from "bun:test";
import type { ServerHandle } from "@reactive-agents/judge-server";
import type { BenchmarkTask } from "../src/types.js";

let server: ServerHandle | undefined;

afterAll(async () => {
  await server?.stop(true);
});

describe("bench scoreTask over RPC (Task 8)", () => {
  it("starts a stub judge-server and scoreTask routes its llm-judge call to it", async () => {
    const { startServer } = await import("@reactive-agents/judge-server");
    server = await startServer({
      port: 0,
      judgeModelSha: "test-judge-sha",
      judgeCodeSha: "test-code-sha",
      judgeLayer: "stub",
    });
    const judgeUrl = `http://127.0.0.1:${server.port}`;

    // Import scoreTask AFTER server boot so any module-init side effects
    // (none expected) cannot race the listen.
    const { scoreTask } = await import("../src/judge.js");

    const task: BenchmarkTask = {
      id: "t-rpc-001",
      name: "rpc-smoke",
      tier: "easy",
      prompt: "What is the capital of France?",
      maxIterations: 3,
      successCriteria: {
        type: "llm-judge",
        rubric: "Answer must mention Paris.",
      },
      primaryDimensions: ["accuracy"],
    };

    const dimensions = await scoreTask(
      "Paris is the capital of France.",
      task,
      "/tmp",
      0,
      1,
      { judgeUrl },
    );

    // The RPC round-trip works (that is what this test pins), but the STUB
    // layer's flat 0.95 is scenery, not a measurement — since 2026-07-11 it
    // surfaces as INCONCLUSIVE (reason "stub-judge") so it can never enter
    // aggregates as a measured score.
    expect(dimensions.length).toBeGreaterThan(0);
    const accuracy = dimensions.find(d => d.dimension === "accuracy");
    expect(accuracy).toBeDefined();
    expect(accuracy!.scoreState).toBe("inconclusive");
    expect(accuracy!.inconclusiveReason).toBe("stub-judge");
    expect(accuracy!.score).toBe(0);
    expect(accuracy!.evidence).toContain("0.95"); // the stub verdict is still visible as evidence
  }, 15000);

  it("surfaces judge outage as INCONCLUSIVE, not a fake 0.0 (no throw)", async () => {
    // Point at a closed port so fetch fails fast.
    const { scoreTask } = await import("../src/judge.js");

    const task: BenchmarkTask = {
      id: "t-rpc-002",
      name: "rpc-fail",
      tier: "easy",
      prompt: "irrelevant",
      maxIterations: 1,
      successCriteria: {
        type: "llm-judge",
        rubric: "anything",
      },
      primaryDimensions: ["accuracy"],
    };

    const dimensions = await scoreTask(
      "anything",
      task,
      "/tmp",
      0,
      1,
      { judgeUrl: "http://127.0.0.1:1" }, // closed
    );

    const accuracy = dimensions.find(d => d.dimension === "accuracy");
    expect(accuracy).toBeDefined();
    // A down judge is an infrastructure event, not a model failure: the score
    // placeholder is 0 but the state is INCONCLUSIVE, so aggregation excludes
    // it instead of reading it as "the model scored zero".
    expect(accuracy!.score).toBe(0);
    expect(accuracy!.scoreState).toBe("inconclusive");
    expect(accuracy!.inconclusiveReason).toBe("judge-outage");
    expect(accuracy!.evidence).toMatch(/judge/i);
  }, 15000);
});
