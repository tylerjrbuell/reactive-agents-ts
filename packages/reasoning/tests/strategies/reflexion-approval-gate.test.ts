// reflexion-approval-gate.test.ts — Durable HITL (Phase D) forwarding into
// reflexion's GENERATE sub-kernel, and the cascade Task 4 pause mint.
//
// Mirrors reactive-approval-gate.test.ts (RunEnvelope.rails.approvalPolicy →
// kernelInput.approvalPolicy → runner → act gate → PAUSE), but for generate
// pass — proving the gate reaches a sub-kernel strategy reaches, not just
// reactive's own kernel.
//
// This also exercises one of the five `finalizePausedStrategyResult` call
// sites (reflexion.ts's generate-pause exit, cross-cutting cascade Task 4):
// none of those five pause mints previously carried a pinned
// `metadata.verdict` assertion anywhere in the suite — reverting the
// generate-pause exit to build its result via `buildStrategyResult` directly
// (bypassing the mint) must fail the verdict assertion below.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";

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

describe("ReflexionStrategy — durable HITL approval gate forwarding into GENERATE", () => {
  it("detach policy pauses a gated tool call during generate (cascade pause mint carries a verdict)", async () => {
    const testLLMLayer = TestLLMServiceLayer([
      { match: "task execution agent", toolCall: { name: "add", args: { a: 2, b: 3 } } },
    ]);
    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(addToolDef, (args) =>
        Effect.succeed((args.a as number) + (args.b as number)),
      );
      return yield* executeReflexion({
        taskDescription: "Add the numbers 2 and 3",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        config: defaultReasoningConfig,
      });
    });

    const result = await Effect.runPromise(provideTestEnvelope(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
      // The gate under test — reaches reflexion's GENERATE sub-kernel. Cascade
      // Task 5: the policy travels ONLY on the envelope now.
      buildRunEnvelope({ approvalPolicy: { mode: "detach", tools: new Set(["add"]) } }),
    ));

    const meta = result.metadata as {
      rawTerminatedBy?: string;
      awaitingApprovalFor?: { toolName: string };
    };
    // The pause actually fired — proves the gate reached reflexion's
    // generate sub-kernel (not just reactive's).
    expect(meta.rawTerminatedBy).toBe("awaiting-approval");
    expect(meta.awaitingApprovalFor?.toolName).toBe("add");
    // The gated tool did NOT execute — no observation step appended.
    expect(result.steps.some((s) => s.type === "observation")).toBe(false);

    // Cascade Task 4 — the pause exit crosses `finalizePausedStrategyResult`,
    // the same terminal mint as every other exit, so it too carries an inert
    // verdict record.
    expect(result.metadata.verdict).toBeDefined();
    expect(result.metadata.verdict?.enforced).toBe(false);
  });
});
