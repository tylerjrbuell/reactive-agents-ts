import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { StreamEvent } from "@reactive-agents/llm-provider";

const testConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 8, temperature: 0.7 },
  },
};

/** Build a proper Stream stub from a response string (mirrors TestLLMService.stream()) */
function makeStreamResponse(content: string): Stream.Stream<StreamEvent, never> {
  return Stream.make(
    { type: "text_delta" as const, text: content },
    { type: "content_complete" as const, content },
    { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
  ) as Stream.Stream<StreamEvent, never>;
}

// Helper to create a capturing LLM layer
async function createCapturingLayer() {
  let capturedContent = "";
  const { LLMService: LLMSvc } = await import("@reactive-agents/llm-provider");
  const layer = Layer.succeed(LLMSvc, {
    complete: (req: any) => {
      const lastMsg = req.messages[req.messages.length - 1];
      capturedContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      return Effect.succeed({
        content: "FINAL ANSWER: done",
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 },
        model: "test-model",
      });
    },
    stream: (req: any) => {
      const lastMsg = req.messages[req.messages.length - 1];
      capturedContent = typeof lastMsg?.content === "string" ? lastMsg.content : "";
      return Effect.succeed(makeStreamResponse("FINAL ANSWER: done"));
    },
    completeStructured: () => Effect.succeed({} as any),
    embed: (texts: string[]) => Effect.succeed(texts.map(() => [])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "test-model" }),
  } as any);
  return { layer, getCaptured: () => capturedContent };
}

// Helper to make a tool schema
function makeTool(name: string, desc: string, params: Array<{ name: string; type: string; required: boolean }> = []) {
  return {
    name,
    description: desc,
    parameters: params.map(p => ({ ...p, description: `${p.name} param` })),
  };
}

describe("Instruction-aware tool filtering", () => {
  it("primary tools shown with full schema when mentioned in task", async () => {
    const { layer, getCaptured } = await createCapturingLayer();

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Use github/list_commits to check recent commits",
        taskType: "git",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [
          makeTool("github/list_commits", "List commits from a repo", [
            { name: "owner", type: "string", required: true },
            { name: "repo", type: "string", required: true },
          ]),
          makeTool("file-write", "Write a file", [
            { name: "path", type: "string", required: true },
            { name: "content", type: "string", required: true },
          ]),
          makeTool("web-search", "Search the web", [
            { name: "query", type: "string", required: true },
          ]),
        ],
        config: testConfig,
      }).pipe(Effect.provide(layer)),
    );

    const content = getCaptured();
    // github/list_commits should have full schema (with description)
    expect(content).toContain("github/list_commits");
    expect(content).toContain("List commits from a repo");
    // Secondary tools should NOT have descriptions in default "full" tier secondary
    // (they get compact format in the "Other tools:" section)
  });

  it("secondary tools collapsed to names for local profile", async () => {
    const { layer, getCaptured } = await createCapturingLayer();

    // Generate many tools, only mention 2 in task
    const tools = [
      makeTool("github/list_commits", "List commits", [{ name: "owner", type: "string", required: true }, { name: "repo", type: "string", required: true }]),
      makeTool("signal/send_message_to_user", "Send signal message", [{ name: "recipient", type: "string", required: true }, { name: "message", type: "string", required: true }]),
      ...Array.from({ length: 8 }, (_, i) => makeTool(`tool-${i}`, `Tool ${i} description`, [{ name: "input", type: "string", required: true }])),
    ];

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Use github/list_commits to check recent commits then send_message_to_user with results",
        taskType: "workflow",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: tools,
        config: testConfig,
        contextProfile: {
          tier: "local",
          promptVerbosity: "minimal",
          rulesComplexity: "simplified",
          fewShotExampleCount: 0,
          compactAfterSteps: 4,
          fullDetailSteps: 2,
          toolResultMaxChars: 400,
          contextBudgetPercent: 70,
          toolSchemaDetail: "names-only",
        },
      }).pipe(Effect.provide(layer)),
    );

    const content = getCaptured();
    // Primary tools should have full descriptions
    expect(content).toContain("List commits");
    expect(content).toContain("Send signal message");
    // Secondary tools should be names only
    expect(content).toContain("Also available (use by name):");
    // Secondary tools should NOT have descriptions
    expect(content).not.toContain("Tool 0 description");
  });

  it("secondary tools get compact schema for full profile", async () => {
    const { layer, getCaptured } = await createCapturingLayer();

    const tools = [
      makeTool("github/list_commits", "List commits", [{ name: "owner", type: "string", required: true }]),
      makeTool("file-write", "Write a file", [{ name: "path", type: "string", required: true }]),
      makeTool("web-search", "Search the web", [{ name: "query", type: "string", required: true }]),
    ];

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Use github/list_commits to find recent activity",
        taskType: "git",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: tools,
        config: testConfig,
        // No contextProfile — defaults to mid/full
      }).pipe(Effect.provide(layer)),
    );

    const content = getCaptured();
    // Primary (mentioned): full schema
    expect(content).toContain("List commits");
    // Secondary should be in "Other tools:" section with compact format (types but no descriptions)
    expect(content).toContain("Other tools:");
  });

  it("all tools are secondary when none mentioned in task", async () => {
    const { layer, getCaptured } = await createCapturingLayer();

    const tools = [
      makeTool("file-write", "Write a file", [{ name: "path", type: "string", required: true }]),
      makeTool("web-search", "Search the web", [{ name: "query", type: "string", required: true }]),
    ];

    await Effect.runPromise(
      executeReactive({
        taskDescription: "Do something interesting with the available tools",
        taskType: "general",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: tools,
        config: testConfig,
        // No tool names mentioned in task — all secondary
      }).pipe(Effect.provide(layer)),
    );

    const content = getCaptured();
    // Should fall back to showing all tools with tier-appropriate format (full by default)
    expect(content).toContain("file-write");
    expect(content).toContain("web-search");
    // Should still have descriptions since it's full format for all-secondary fallback
    expect(content).toContain("Write a file");
    expect(content).toContain("Search the web");
  });
});
