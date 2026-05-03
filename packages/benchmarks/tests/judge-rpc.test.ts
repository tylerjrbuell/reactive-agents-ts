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

    // Stub layer always returns passed:true overallScore:0.95.
    expect(dimensions.length).toBeGreaterThan(0);
    const accuracy = dimensions.find(d => d.dimension === "accuracy");
    expect(accuracy).toBeDefined();
    expect(accuracy!.score).toBeCloseTo(0.95, 2);
  }, 15000);

  it("propagates judge HTTP failures as score 0 with evidence (no throw)", async () => {
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
    expect(accuracy!.score).toBe(0);
    expect(accuracy!.evidence).toMatch(/judge/i);
  }, 15000);
});
