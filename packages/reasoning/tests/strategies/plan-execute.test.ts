// File: tests/strategies/plan-execute.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";

// ── Helpers ──

/** Build a valid JSON plan for the TestLLM to return */
function makePlanJson(
  steps: Array<{
    title: string;
    instruction: string;
    type: "tool_call" | "analysis" | "composite";
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolHints?: string[];
    dependsOn?: string[];
  }>,
): string {
  return JSON.stringify({ steps });
}

/** A simple 2-step analysis plan */
const TWO_STEP_ANALYSIS_PLAN = makePlanJson([
  {
    title: "Research the topic",
    instruction: "Find relevant information about the topic",
    type: "analysis",
  },
  {
    title: "Summarize findings",
    instruction: "Write a clear summary of the findings",
    type: "analysis",
  },
]);

/** A plan with a tool_call step and an analysis step */
const TOOL_AND_ANALYSIS_PLAN = makePlanJson([
  {
    title: "Search for data",
    instruction: "Search the web for test data",
    type: "tool_call",
    toolName: "web-search",
    toolArgs: { query: "test data" },
  },
  {
    title: "Summarize findings",
    instruction: "Write a summary of the search results",
    type: "analysis",
  },
]);

/** A plan with step references */
const REFERENCE_PLAN = makePlanJson([
  {
    title: "Fetch data",
    instruction: "Get the initial data",
    type: "tool_call",
    toolName: "web-search",
    toolArgs: { query: "initial data" },
  },
  {
    title: "Process data",
    instruction: "Process the fetched data",
    type: "tool_call",
    toolName: "file-write",
    toolArgs: { path: "output.txt", content: "{{from_step:s1}}" },
  },
]);

describe("PlanExecuteStrategy (Structured Plan Engine)", () => {
  it("should generate a structured plan, execute steps, and return completed result", async () => {
    // Pattern matching:
    // 1. "planning agent" matches the system prompt for plan generation (extractStructuredOutput adds "Respond with ONLY valid JSON")
    // 2. "OVERALL GOAL" matches the step execution prompt from buildStepExecutionPrompt
    // 3. "GOAL:" matches the reflection prompt from buildReflectionPrompt
    // 4. "Synthesize" matches the synthesis prompt
    const layer = TestLLMServiceLayer({
      "planning agent": TWO_STEP_ANALYSIS_PLAN,
      "OVERALL GOAL": "FINAL ANSWER: Step analysis completed successfully.",
      "GOAL:": "SATISFIED: All steps completed and the task is fully addressed.",
      "Synthesize": "The topic has been thoroughly researched and summarized with key findings.",
    });

    const program = executePlanExecute({
      taskDescription: "Research quantum computing trends",
      taskType: "research",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("plan-execute-reflect");
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);

    // Should have PLAN, EXEC, REFLECT, and SYNTHESIS steps
    const planSteps = result.steps.filter((s) =>
      s.content.startsWith("[PLAN"),
    );
    const execSteps = result.steps.filter((s) =>
      s.content.startsWith("[EXEC"),
    );
    const reflectSteps = result.steps.filter((s) =>
      s.content.startsWith("[REFLECT"),
    );
    const synthSteps = result.steps.filter((s) =>
      s.content.startsWith("[SYNTHESIS"),
    );

    expect(planSteps.length).toBeGreaterThanOrEqual(1);
    expect(execSteps.length).toBe(2); // 2 analysis steps
    expect(reflectSteps.length).toBeGreaterThanOrEqual(1);
    expect(synthSteps.length).toBe(1);
  });

  it("should return partial result when max refinements reached without satisfaction", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent": makePlanJson([
        {
          title: "Investigate",
          instruction: "Investigate the problem",
          type: "analysis",
        },
      ]),
      "OVERALL GOAL": "FINAL ANSWER: Investigation completed.",
    });
    // No reflection pattern → defaults to "Test response" which won't match SATISFIED:

    const program = executePlanExecute({
      taskDescription: "An impossible task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: {
        ...defaultReasoningConfig,
        strategies: {
          ...defaultReasoningConfig.strategies,
          planExecute: { maxRefinements: 1, reflectionDepth: "shallow" },
        },
      },
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("plan-execute-reflect");
    // Should still produce output even after exhausting refinements
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.metadata.stepsCount).toBeGreaterThan(0);

    // Should have plan, execution, and reflection steps
    const planSteps = result.steps.filter((s) =>
      s.content.startsWith("[PLAN"),
    );
    const execSteps = result.steps.filter((s) =>
      s.content.startsWith("[EXEC"),
    );
    const reflectSteps = result.steps.filter((s) =>
      s.content.startsWith("[REFLECT"),
    );

    expect(planSteps.length).toBeGreaterThanOrEqual(1);
    expect(execSteps.length).toBeGreaterThanOrEqual(1);
    expect(reflectSteps.length).toBeGreaterThanOrEqual(1);
  });

  it("should track token usage and cost across plan-execute-reflect cycle", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent": makePlanJson([
        {
          title: "Look up answer",
          instruction: "Find the answer",
          type: "analysis",
        },
      ]),
      "OVERALL GOAL": "FINAL ANSWER: The answer is 42.",
      "GOAL:": "SATISFIED: Task fully addressed.",
      "Synthesize": "The answer is 42.",
    });

    const program = executePlanExecute({
      taskDescription: "Simple task",
      taskType: "query",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    expect(result.metadata.tokensUsed).toBeGreaterThan(0);
    expect(result.metadata.cost).toBeGreaterThanOrEqual(0);
    expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
  });

  it("should dispatch tool_call steps directly via toolService.execute", async () => {
    let toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> =
      [];

    const mockToolService = {
      execute: (input: {
        toolName: string;
        arguments: Record<string, unknown>;
        agentId: string;
        sessionId: string;
      }) => {
        toolCalls.push({
          toolName: input.toolName,
          args: input.arguments,
        });
        return Effect.succeed({
          result: `Results for ${input.toolName}`,
          success: true,
        });
      },
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test",
          parameters: [],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    };

    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of(mockToolService),
    );

    const llmLayer = TestLLMServiceLayer({
      "planning agent": TOOL_AND_ANALYSIS_PLAN,
      "OVERALL GOAL": "FINAL ANSWER: Summary of the search results.",
      "GOAL:": "SATISFIED: All steps completed.",
      "Synthesize": "The synthesized final answer from search results.",
    });

    const program = executePlanExecute({
      taskDescription: "Search and summarize test data",
      taskType: "research",
      memoryContext: "",
      availableTools: ["web-search"],
      availableToolSchemas: [
        {
          name: "web-search",
          description: "Search the web",
          parameters: [
            { name: "query", type: "string", description: "Query", required: true },
          ],
        },
      ],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(llmLayer, toolLayer))),
    );

    expect(result.status).toBe("completed");
    // The tool_call step should have been dispatched directly
    expect(toolCalls.length).toBeGreaterThanOrEqual(1);
    expect(toolCalls[0]!.toolName).toBe("web-search");
    expect(toolCalls[0]!.args).toEqual({ query: "test data" });
  });

  it("should use ReAct kernel for analysis steps", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent": makePlanJson([
        {
          title: "Analyze data",
          instruction: "Perform deep analysis of the data",
          type: "analysis",
        },
      ]),
      "OVERALL GOAL": "FINAL ANSWER: Deep analysis shows positive trends.",
      "GOAL:": "SATISFIED: Analysis complete.",
      "Synthesize": "Analysis reveals positive trends in the data.",
    });

    const program = executePlanExecute({
      taskDescription: "Analyze market data trends",
      taskType: "analysis",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    // Should have executed the analysis step via kernel
    const execSteps = result.steps.filter((s) =>
      s.content.startsWith("[EXEC"),
    );
    expect(execSteps.length).toBe(1);
    expect(execSteps[0]!.content).toContain("Deep analysis");
  });

  it("should resolve step references in tool_call args ({{from_step:s1}})", async () => {
    let toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> =
      [];

    const mockToolService = {
      execute: (input: {
        toolName: string;
        arguments: Record<string, unknown>;
        agentId: string;
        sessionId: string;
      }) => {
        toolCalls.push({
          toolName: input.toolName,
          args: input.arguments,
        });
        if (input.toolName === "web-search") {
          return Effect.succeed({
            result: "Search result: quantum computing data",
            success: true,
          });
        }
        return Effect.succeed({
          result: `Written: ${JSON.stringify(input.arguments)}`,
          success: true,
        });
      },
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test",
          parameters: [],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    };

    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of(mockToolService),
    );

    const llmLayer = TestLLMServiceLayer({
      "planning agent": REFERENCE_PLAN,
      "GOAL:": "SATISFIED: Data fetched and processed.",
      "Synthesize": "Data was fetched and written to file.",
    });

    const program = executePlanExecute({
      taskDescription: "Fetch and process data",
      taskType: "data-pipeline",
      memoryContext: "",
      availableTools: ["web-search", "file-write"],
      availableToolSchemas: [
        {
          name: "web-search",
          description: "Search",
          parameters: [
            { name: "query", type: "string", description: "Query", required: true },
          ],
        },
        {
          name: "file-write",
          description: "Write file",
          parameters: [
            { name: "path", type: "string", description: "Path", required: true },
            { name: "content", type: "string", description: "Content", required: true },
          ],
        },
      ],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(Layer.merge(llmLayer, toolLayer))),
    );

    expect(result.status).toBe("completed");
    expect(toolCalls.length).toBe(2);

    // Second tool call should have resolved {{from_step:s1}} to the web-search result
    const fileWriteCall = toolCalls[1]!;
    expect(fileWriteCall.toolName).toBe("file-write");
    expect(fileWriteCall.args.content).toBe(
      "Search result: quantum computing data",
    );
  });

  it("should produce a synthesized final answer via LLM after reflection satisfies", async () => {
    const layer = TestLLMServiceLayer({
      "planning agent": makePlanJson([
        {
          title: "Research topic",
          instruction: "Research quantum computing",
          type: "analysis",
        },
        {
          title: "Write summary",
          instruction: "Summarize the research",
          type: "analysis",
        },
      ]),
      "OVERALL GOAL": "FINAL ANSWER: Research findings are detailed.",
      "GOAL:": "SATISFIED: Task complete.",
      "Synthesize":
        "The final synthesized answer: Quantum computing is advancing rapidly with key breakthroughs.",
    });

    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Research and summarize quantum computing",
        taskType: "research",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    expect(typeof result.output).toBe("string");
    expect((result.output as string).length).toBeGreaterThan(0);
    // Should have a SYNTHESIS step
    const synthStep = result.steps.find((s) =>
      s.content.startsWith("[SYNTHESIS]"),
    );
    expect(synthStep).toBeDefined();
    expect(synthStep!.content).toContain("Quantum computing");
  });
});
