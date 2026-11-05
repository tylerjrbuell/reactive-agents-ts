// File: tests/strategies/plan-reflect-skip.test.ts
//
// S4b (Plan 9): plan-execute skips its reflect LLM call when every step
// completed AND the deterministic delivery judgment verified at least one
// contract condition with nothing unmet (the reflect call could only say
// SATISFIED there). A poor contract (only the `answer` floor) keeps it.
//
// RED-ON-CUT: drop the skip branch in plan-execute/reflect.ts and the first
// test sees a reflect request; skip unconditionally and the second loses its.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMService, LLMService } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const REFLECT_MARKER = "evaluating plan execution";

const addTool = {
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

/** Run plan-execute on a scripted plan, recording every model request. */
const run = (plan: unknown, requiredTools: readonly string[]) => {
  const requests: string[] = [];
  const base = TestLLMService([
    { match: "planning agent", text: JSON.stringify(plan) },
    { match: REFLECT_MARKER, text: "SATISFIED: done." },
    { text: "The sum is 5." },
  ]);
  const llm = Layer.succeed(LLMService, LLMService.of({
    ...base,
    complete: (req: Parameters<typeof base.complete>[0]) => {
      requests.push(JSON.stringify(req));
      return base.complete(req);
    },
  }));
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(addTool, (args) => Effect.succeed((args.a as number) + (args.b as number)));
    return yield* executePlanExecute({
      taskDescription: "Use the add tool to add 2 and 3, then report the sum.",
      taskType: "computation",
      memoryContext: "",
      availableTools: ["add"],
      availableToolSchemas: [{ name: "add", description: addTool.description, parameters: addTool.parameters }],
      requiredTools,
      config: defaultReasoningConfig,
    });
  });
  return Effect.runPromise(provideTestEnvelope(program.pipe(Effect.provide(Layer.merge(llm, createToolsLayer())))))
    .then((result) => ({ result, requests }));
};

describe("plan-execute reflect skip (deterministic delivery verified)", () => {
  it("every step completed and the required tool verified: no reflect call, the skip is traced", async () => {
    const { result, requests } = await run(
      { steps: [{ title: "Add", instruction: "add them", type: "tool_call", toolName: "add", toolArgs: { a: 2, b: 3 } }] },
      ["add"],
    );
    expect(requests.some((r) => r.includes(REFLECT_MARKER))).toBe(false);
    expect(result.steps.some((s) => s.content.includes("skipped — every step completed and delivery verified"))).toBe(true);
    expect(result.status).toBe("completed");
  }, 30_000);

  it("a poor contract (only the answer floor) keeps the reflect call", async () => {
    const { requests } = await run(
      {
        steps: [
          { title: "Think", instruction: "think about it", type: "analysis" },
          { title: "Write up", instruction: "write it up", type: "analysis" },
        ],
      },
      [],
    );
    expect(requests.some((r) => r.includes(REFLECT_MARKER))).toBe(true);
  }, 30_000);
});
