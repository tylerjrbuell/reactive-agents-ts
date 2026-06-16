// reactive-approval-gate.test.ts — Durable HITL (Phase D) full-chain forwarding.
//
// Proves the approval policy threads ALL the way through the reactive strategy:
// executeReactive(input.approvalPolicy) → kernelInput.approvalPolicy → runner →
// act gate → PAUSE (terminatedBy "awaiting-approval", tool NOT executed). This is
// the chain the runtime live path uses; a forwarding gap here is why a real run
// would execute a gated tool instead of pausing.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { process.env.RA_LAZY_TOOLS = "0"; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

const addToolDef = {
  name: "add",
  description: "Add two numbers together",
  parameters: [
    { name: "a", type: "number" as const, description: "First number", required: true },
    { name: "b", type: "number" as const, description: "Second number", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const testConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 5, temperature: 0.7 },
  },
};

describe("ReactiveStrategy — durable HITL approval gate forwarding", () => {
  it("detach policy pauses a gated tool call (terminatedBy=awaiting-approval, tool NOT executed)", async () => {
    const testLLMLayer = TestLLMServiceLayer([
      { match: "step by step", toolCall: { name: "add", args: { a: 2, b: 3 } } },
      { match: "Observation", text: "FINAL ANSWER: 5." },
    ]);
    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(addToolDef, (args) =>
        Effect.succeed((args.a as number) + (args.b as number)),
      );
      return yield* executeReactive({
        taskDescription: "Add the numbers 2 and 3",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        // `add` is ALSO a required tool — exercises the auto-required-tools
        // redirect that (pre-fix) looped a gated pause to max_iterations because
        // the gated call never "executes".
        requiredTools: ["add"],
        config: testConfig,
        // The gate under test:
        approvalPolicy: { mode: "detach", tools: new Set(["add"]) },
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    const meta = result.metadata as {
      terminatedBy?: string;
      rawTerminatedBy?: string;
      awaitingApprovalFor?: { toolName: string };
    };
    // The raw kernel reason + the gate descriptor carry the pause (the closed
    // 5-value `terminatedBy` maps awaiting-approval → end_turn cosmetically; the
    // engine's persist + stream surface read `awaitingApprovalFor`, not terminatedBy).
    expect(meta.rawTerminatedBy).toBe("awaiting-approval");
    expect(meta.awaitingApprovalFor?.toolName).toBe("add");
    // The gated tool did NOT execute — no observation step appended.
    expect(result.steps.some((s) => s.type === "observation")).toBe(false);
  });

  it("WITHOUT a policy, the same tool call executes normally (control)", async () => {
    const testLLMLayer = TestLLMServiceLayer([
      { match: "step by step", toolCall: { name: "add", args: { a: 2, b: 3 } } },
      { match: "Observation", text: "FINAL ANSWER: 5." },
    ]);
    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(addToolDef, (args) =>
        Effect.succeed((args.a as number) + (args.b as number)),
      );
      return yield* executeReactive({
        taskDescription: "Add the numbers 2 and 3",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        config: testConfig,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    const meta = result.metadata as { terminatedBy?: string };
    expect(meta.terminatedBy).not.toBe("awaiting-approval");
    expect(result.steps.some((s) => s.type === "observation")).toBe(true);
  });
});
