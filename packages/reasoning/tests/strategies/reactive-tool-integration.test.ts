// File: tests/strategies/reactive-tool-integration.test.ts
//
// Proves that the ReAct strategy executes real tools (not placeholders)
// when ToolService is present in the Effect context.
//
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { LLMService, TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import {
  ToolService,
  ToolExecutionError,
  createToolsLayer,
} from "@reactive-agents/tools";

// ─── Shared tool definitions ───

const addToolDef = {
  name: "add",
  description: "Add two numbers together",
  parameters: [
    {
      name: "a",
      type: "number" as const,
      description: "First number",
      required: true,
    },
    {
      name: "b",
      type: "number" as const,
      description: "Second number",
      required: true,
    },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const brokenToolDef = {
  name: "broken-tool",
  description: "A tool that always fails",
  parameters: [
    {
      name: "x",
      type: "number" as const,
      description: "Input",
      required: true,
    },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const greetToolDef = {
  name: "greet",
  description: "Greet a person by name",
  parameters: [
    {
      name: "name",
      type: "string" as const,
      description: "Name to greet",
      required: true,
    },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

// ─── Config with short iteration limit for fast tests ───

const testConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 5, temperature: 0.7 },
  },
};

// ─── Tests ───

describe("ReactiveStrategy — real tool execution", () => {
  it("executes tool and feeds real result as observation (JSON args)", async () => {
    // LLM sequence:
    // 1. First thought (no Observation yet): request tool call with JSON args
    // 2. After Observation appears in context: give final answer
    const testLLMLayer = TestLLMServiceLayer({
      Observation: "FINAL ANSWER: The sum of 2 and 3 is 5.",
      "step-by-step": 'I need to add these numbers. ACTION: add({"a": 2, "b": 3})',
    });

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

    expect(result.status).toBe("completed");

    const actionSteps = result.steps.filter((s) => s.type === "action");
    const observationSteps = result.steps.filter(
      (s) => s.type === "observation",
    );

    expect(actionSteps.length).toBeGreaterThanOrEqual(1);
    expect(observationSteps.length).toBeGreaterThanOrEqual(1);

    // ✅ Observation contains the REAL result from the handler, not a placeholder
    const obs = observationSteps[0];
    expect(obs.content).not.toContain("[Tool call requested:");
    expect(obs.content).not.toContain("ToolService not available");
    expect(obs.content).toBe("5"); // JSON.stringify(2 + 3)
  });

  it("executes tool with string arg mapped to first parameter", async () => {
    // The LLM uses plain-string format: ACTION: greet(Alice)
    // The strategy should map "Alice" → {name: "Alice"}
    const testLLMLayer = TestLLMServiceLayer({
      Observation: "FINAL ANSWER: Done.",
      "step-by-step": "ACTION: greet(Alice)",
    });

    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(greetToolDef, (args) =>
        Effect.succeed(`Hello, ${args.name}!`),
      );

      return yield* executeReactive({
        taskDescription: "Greet Alice",
        taskType: "interaction",
        memoryContext: "",
        availableTools: ["greet"],
        config: testConfig,
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    const observationSteps = result.steps.filter(
      (s) => s.type === "observation",
    );
    expect(observationSteps.length).toBeGreaterThanOrEqual(1);
    // Real result from handler — not a placeholder
    expect(observationSteps[0].content).toBe("Hello, Alice!");
  });

  it("notes tool unavailability when ToolService is not in context", async () => {
    // No ToolService provided — observation should clearly state it's unavailable
    const testLLMLayer = TestLLMServiceLayer({
      "ToolService is not available": "FINAL ANSWER: No tools available.",
      "step-by-step": 'I need to add. ACTION: add({"a": 1, "b": 2})',
    });

    const program = executeReactive({
      taskDescription: "Add 1 and 2",
      taskType: "computation",
      memoryContext: "",
      availableTools: ["add"],
      config: testConfig,
    });

    // No toolsLayer provided — only LLM
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testLLMLayer)),
    );

    const observationSteps = result.steps.filter(
      (s) => s.type === "observation",
    );
    expect(observationSteps.length).toBeGreaterThanOrEqual(1);
    expect(observationSteps[0].content).toContain("ToolService is not available");
  });

  it("captures tool execution errors as observations (does not throw)", async () => {
    const testLLMLayer = TestLLMServiceLayer({
      "Tool error": "FINAL ANSWER: The tool failed.",
      "step-by-step": 'ACTION: broken-tool({"x": 42})',
    });

    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(brokenToolDef, (_args) =>
        Effect.fail(
          new ToolExecutionError({
            message: "Intentional test failure",
            toolName: "broken-tool",
          }),
        ),
      );

      return yield* executeReactive({
        taskDescription: "Use the broken tool",
        taskType: "test",
        memoryContext: "",
        availableTools: ["broken-tool"],
        config: testConfig,
      });
    });

    // Should NOT throw — error becomes an observation
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(testLLMLayer, toolsLayer))),
    );

    const observationSteps = result.steps.filter(
      (s) => s.type === "observation",
    );
    expect(observationSteps.length).toBeGreaterThanOrEqual(1);
    expect(observationSteps[0].content).toContain("Tool error:");
    expect(observationSteps[0].content).toContain("Intentional test failure");
  });

  it("includes registered tool names in initial context prompt", async () => {
    // When availableTools is populated, the context should mention them
    let capturedPrompt = "";

    const capturingLLMLayer = Layer.succeed(LLMService, {
      complete: (req: { messages: { role: string; content: string }[] }) => {
        const lastMsg = req.messages[req.messages.length - 1];
        capturedPrompt =
          typeof lastMsg?.content === "string" ? lastMsg.content : "";
        return Effect.succeed({
          content: "FINAL ANSWER: done",
          stopReason: "end_turn" as const,
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            estimatedCost: 0,
          },
          model: "test",
        });
      },
      stream: () => Stream.empty,
      embed: () =>
        Effect.succeed({
          embeddings: [] as number[][],
          model: "test",
          usage: { totalTokens: 0 },
        }),
    });

    const program = executeReactive({
      taskDescription: "Test task",
      taskType: "test",
      memoryContext: "",
      availableTools: ["web-search", "file-read"],
      config: testConfig,
    });

    await Effect.runPromise(program.pipe(Effect.provide(capturingLLMLayer)));

    // The prompt should mention available tools and JSON format hint
    expect(capturedPrompt).toContain("web-search");
    expect(capturedPrompt).toContain("file-read");
    expect(capturedPrompt).toContain("ACTION: tool_name(");
  });
});
