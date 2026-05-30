// Run: bun test packages/reasoning/tests/strategies/reflexion-required-completion-gate.test.ts --timeout 20000
//
// Regression: reflexion's `isSatisfied(critique)` judges OUTPUT TEXT only — it
// cannot see whether a required side-effect tool actually fired. A task like
// "create a markdown file" yields a good-looking summary the critique rubber-
// stamps as SATISFIED while the file was never written (spot-test: success:true,
// no commits.md — the verifier lied). The completion gate must NOT accept
// "satisfied" while a required tool is still uncalled.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { delete process.env.RA_LAZY_TOOLS; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

// Mock LLM: gen/improve passes emit a plain text answer (NO tool call); the
// critique pass (system prompt mentions "critical evaluator") returns SATISFIED.
// So without the gate, reflexion terminates "satisfied" on iteration 1 despite
// `file-write` never being called.
async function makeMockLayer() {
  const { LLMService } = await import("@reactive-agents/llm-provider");
  const respond = (req: any) => {
    const sys = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
    const isCritique = sys.includes("critical evaluator") || sys.includes("critique");
    const content = isCritique
      ? "SATISFIED: the response fully addresses the task."
      : "Here is the report:\n\n# Commits\n- feat: things\n- fix: bugs";
    return { content, stopReason: "end_turn" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 }, model: "m" };
  };
  const layer = Layer.succeed(LLMService, {
    complete: (req: any) => Effect.succeed(respond(req)),
    stream: (req: any) => {
      const c = respond(req).content;
      return Effect.succeed(
        Stream.make(
          { type: "text_delta" as const, text: c },
          { type: "content_complete" as const, content: c },
          { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
        ) as any,
      );
    },
    completeStructured: () => Effect.succeed({} as any),
    embed: (t: string[]) => Effect.succeed(t.map(() => [])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "m" }),
  } as any);
  return layer;
}

describe("reflexion required-tools completion gate", () => {
  it("does NOT report success when a required tool was never called, despite SATISFIED critique", async () => {
    const layer = await makeMockLayer();
    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Fetch data and create a markdown file (./out.md) summarizing it.",
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [
          { name: "file-write", description: "Write a file", parameters: [
            { name: "path", type: "string", description: "path", required: true },
            { name: "content", type: "string", description: "content", required: true },
          ] },
        ],
        requiredTools: ["file-write"],
        config: defaultReasoningConfig,
      } as any).pipe(Effect.provide(layer)),
    );
    // file-write never fired → must not be reported as a completed task.
    expect(result.status).not.toBe("completed");
  }, 20000);

  it("reports success normally when there are NO required tools (gate is scoped)", async () => {
    const layer = await makeMockLayer();
    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Summarize the concept of recursion in two sentences.",
        taskType: "general",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [],
        config: defaultReasoningConfig,
      } as any).pipe(Effect.provide(layer)),
    );
    expect(result.status).toBe("completed");
  }, 20000);
});
