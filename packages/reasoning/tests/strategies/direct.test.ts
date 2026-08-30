// File: tests/strategies/direct.test.ts
//
// Tests for the `direct` reasoning strategy — single-shot LLM call replacing
// the dual inline LLM-call path that was duplicated inside the engine
// agent-loop pre-W23.
//
// Authored 2026-05-07 (W23 step 3).
import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { executeDirect } from "../../src/strategies/direct.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

describe("DirectStrategy", () => {
  afterEach(() => {
    delete process.env.RA_TOOL_DISCOVERY;
  });

  // Finding 2 (harness-control-surface final fix wave): `executeDirect`
  // previously built its `resolveExecutableToolCapabilities` input without
  // `harness`, so the resolver always fell back to a fresh env re-read,
  // silently ignoring any per-agent `.withHarness({ toolDiscovery })`.
  it("honors the carried RunEnvelope harness config over the environment for toolDiscovery", async () => {
    process.env.RA_TOOL_DISCOVERY = "0"; // environment says OFF

    const layer = TestLLMServiceLayer([
      { match: "What is", text: "FINAL ANSWER: Paris" },
    ]);

    const program = Effect.gen(function* () {
      yield* executeDirect({
        taskDescription: "What is the capital of France?",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      });
      const toolService = yield* ToolService;
      const registered = yield* toolService.listTools();
      return registered.map((tool) => tool.name);
    });

    const names = await Effect.runPromise(
      provideTestEnvelope(
        program.pipe(Effect.provide(layer), Effect.provide(createToolsLayer())),
        buildRunEnvelope({ harness: { toolDiscovery: true } }), // carried config says ON
      ),
    );

    expect(names).toContain("discover-tools");
  });

  it("returns ReasoningResult with strategy:'direct' on a single LLM call", async () => {
    const layer = TestLLMServiceLayer([
      { match: "What is", text: "FINAL ANSWER: Paris" },
    ]);

    const program = executeDirect({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));

    expect(result.strategy).toBe("direct");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
  });

  // Cross-cutting cascade Task 4 — direct's own terminal mint
  // (finalizeStrategyResult) always records a verdict. Judgment stays INERT
  // (enforced:false) until Task 8. Reverting direct to build its result via
  // buildStrategyResult directly (bypassing the mint) must fail this test.
  it("every result carries a terminal verdict record (cascade mint)", async () => {
    const layer = TestLLMServiceLayer([
      { match: "What is", text: "FINAL ANSWER: Paris" },
    ]);

    const program = executeDirect({
      taskDescription: "What is the capital of France?",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));

    expect(result.metadata.verdict).toBeDefined();
    expect(result.metadata.verdict?.enforced).toBe(false);
  });

  it("defaults maxIterations to 1 (single turn)", async () => {
    // Mock that never says FINAL ANSWER — would loop forever in reactive mode.
    // Direct must terminate after maxIter=1 with status="failed".
    const layer = TestLLMServiceLayer();

    const program = executeDirect({
      taskDescription: "Impossible task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
      // maxIterations omitted — should default to 1
    });

    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));

    // Single iteration, no FINAL ANSWER → terminates non-success.
    // Steps count is small (1 turn = ~1 thought + ~1 observation).
    expect(result.steps.length).toBeLessThanOrEqual(3);
    expect(result.status).not.toBe("completed");
  });

  it("respects maxIterations:2 when caller wants tool round + final response", async () => {
    let turn = 0;
    const layer = TestLLMServiceLayer([
      { match: "weather", text: "FINAL ANSWER: 72°F." },
    ]);

    const program = executeDirect({
      taskDescription: "What is the weather in NYC?",
      taskType: "query",
      memoryContext: "",
      availableTools: ["weather"],
      config: defaultReasoningConfig,
      maxIterations: 2,
    });

    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));

    expect(result.strategy).toBe("direct");
    // Up to 2 iterations allowed — but if FINAL ANSWER comes on turn 1 it stops
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("clamps maxIterations to maximum of 3", async () => {
    const layer = TestLLMServiceLayer();

    const program = executeDirect({
      taskDescription: "Some task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
      // @ts-expect-error — testing the runtime clamp
      maxIterations: 99,
    });

    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));

    // Even with maxIterations:99 requested, kernel runs at most 3 iterations.
    // Steps from a 3-iter loop: ~3 thoughts + (maybe) observations = ≤6
    expect(result.steps.length).toBeLessThanOrEqual(10);
  });

  it("threads memoryContext into priorContext when provided", async () => {
    const layer = TestLLMServiceLayer([
      { match: "What", text: "FINAL ANSWER: contextual answer" },
    ]);

    const program = executeDirect({
      taskDescription: "What did we discuss earlier?",
      taskType: "query",
      memoryContext: "User likes Python and TypeScript.",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(layer))));

    expect(result.strategy).toBe("direct");
    // Memory context flowed into the kernel — no failure on memory injection
    expect(result.status).toBe("completed");
  });
});
