// File: tests/strategies/plan-execute.test.ts
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer, TestLLMService, LLMService, type TestTurn } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";

/**
 * Wrap TestLLMService and record every request's stringified content so a test
 * can assert which prompts were (not) issued — e.g. the planner rationale
 * strict-retry ("[STRICT RETRY]").
 */
function makeRecordingLLM(scenario: TestTurn[]) {
  const base = TestLLMService(scenario);
  const prompts: string[] = [];
  const rec = {
    ...base,
    complete: (req: Parameters<typeof base.complete>[0]) => {
      prompts.push(JSON.stringify(req));
      return base.complete(req);
    },
    completeStructured: (req: Parameters<typeof base.completeStructured>[0]) => {
      prompts.push(JSON.stringify(req));
      return base.completeStructured(req);
    },
  };
  return { layer: Layer.succeed(LLMService, LLMService.of(rec)), prompts };
}

/** Mock ToolService so tool_call steps can dispatch without a real tool layer. */
const RATIONALE_TOOL_LAYER = Layer.succeed(
  ToolService,
  ToolService.of({
    execute: () => Effect.succeed({ success: true, result: "tool ok" }),
    getTool: (name: string) =>
      Effect.succeed({ name, description: "test", parameters: [] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  } as unknown as Parameters<typeof ToolService.of>[0]),
);

/** A tool_call+analysis plan with NO rationale on the tool_call step. */
const NO_RATIONALE_TOOL_PLAN = JSON.stringify({
  steps: [
    { title: "Fetch", instruction: "fetch data", type: "tool_call", toolName: "web-search", toolArgs: { query: "x" } },
    { title: "Summarize", instruction: "summarize", type: "analysis" },
  ],
});

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
    rationale?: { why: string; confidence?: number };
  }>,
): string {
  // Auto-fill rationale on tool_call steps so plan-execute's rationale
  // enforcement retry does not consume an extra mock LLM turn in tests.
  const enriched = steps.map((s) =>
    s.type === "tool_call" && !s.rationale
      ? { ...s, rationale: { why: `Test fixture rationale: ${s.title}`, confidence: 0.9 } }
      : s,
  );
  return JSON.stringify({ steps: enriched });
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
    // Turn sequence with 2 analysis steps:
    // 1. Plan generation → TWO_STEP_ANALYSIS_PLAN
    // 2. Step 1 execution (analysis via kernel) → FINAL ANSWER
    // 3. Step 2 execution (analysis via kernel) → FINAL ANSWER
    // 4. Reflection → SATISFIED
    // 5. Synthesis → final answer text
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: TWO_STEP_ANALYSIS_PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Step analysis completed successfully." },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary written." },
      { match: "GOAL:", text: "SATISFIED: All steps completed and the task is fully addressed." },
      { match: "Synthesize", text: "The topic has been thoroughly researched and summarized with key findings." },
    ]);

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
    // NOTE: uses a TWO-step plan on purpose. A single analysis-step plan now
    // takes the streamline short-circuit (one structured generation, no
    // refinement loop), so it can no longer exercise refinement-exhaustion.
    // Two steps keep the full plan→execute→reflect→refine path under test.
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: makePlanJson([
        {
          title: "Investigate",
          instruction: "Investigate the problem",
          type: "analysis",
        },
        {
          title: "Analyze",
          instruction: "Analyze the investigation",
          type: "analysis",
        },
      ]) },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Investigation completed." },
    ]);
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

  it("short-circuits a single-analysis-step plan to ONE structured generation (no double-generate, no reflect)", async () => {
    // Streamline: when the planner emits exactly one analysis step (task did not
    // decompose), plan-execute previously generated the answer twice — once in
    // step execution, once in synthesis — plus a no-value reflect pass. The
    // short-circuit collapses this to a single structured generation so a
    // non-decomposable task degrades gracefully to ~reactive cost.
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: makePlanJson([
        {
          title: "Explain indexing trade-offs",
          instruction: "Explain B-tree, hash, and full-text indexing across three sections",
          type: "analysis",
        },
      ]) },
      // The short-circuit's single generation prompt carries this phrase.
      { match: "well-structured final answer", text: "## B-tree\nRange queries.\n## Hash\nExact match.\n## Full-text\nSearch." },
    ]);

    const program = executePlanExecute({
      taskDescription: "Explain database indexing trade-offs",
      taskType: "explanation",
      memoryContext: "",
      availableTools: [],
      config: defaultReasoningConfig,
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));

    expect(result.status).toBe("completed");
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain("B-tree");

    const execSteps = result.steps.filter((s) => s.content.startsWith("[EXEC"));
    const reflectSteps = result.steps.filter((s) => s.content.startsWith("[REFLECT"));
    const synthSteps = result.steps.filter((s) => s.content.startsWith("[SYNTHESIS"));

    // Short-circuit path: no per-step EXEC, no REFLECT — just one SYNTHESIS.
    expect(execSteps.length).toBe(0);
    expect(reflectSteps.length).toBe(0);
    expect(synthSteps.length).toBe(1);
  }, 30000);

  it("skips the planner rationale strict-retry by default (audit off)", async () => {
    // rationale.why is audit-only (debrief), not execution — so when auditing is
    // off (default) a plan missing rationale on tool_call steps must NOT trigger
    // a full re-plan. Saves a planner LLM call on models that omit rationale.
    const { layer: llmLayer, prompts } = makeRecordingLLM([
      { match: "planning agent", text: NO_RATIONALE_TOOL_PLAN },
      { match: "GOAL:", text: "SATISFIED: done." },
      { match: "Synthesize", text: "Final answer." },
    ]);

    await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Fetch and summarize",
        taskType: "research",
        memoryContext: "",
        availableTools: ["web-search"],
        config: defaultReasoningConfig,
        // auditRationale omitted → default OFF
      }).pipe(Effect.provide(Layer.merge(llmLayer, RATIONALE_TOOL_LAYER))),
    );

    const issuedRetry = prompts.some((p) => p.includes("STRICT RETRY"));
    expect(issuedRetry).toBe(false);
  }, 30000);

  it("issues the planner rationale strict-retry when auditRationale is on", async () => {
    const { layer: llmLayer, prompts } = makeRecordingLLM([
      { match: "planning agent", text: NO_RATIONALE_TOOL_PLAN },
      { match: "GOAL:", text: "SATISFIED: done." },
      { match: "Synthesize", text: "Final answer." },
    ]);

    await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Fetch and summarize",
        taskType: "research",
        memoryContext: "",
        availableTools: ["web-search"],
        config: defaultReasoningConfig,
        auditRationale: true,
      }).pipe(
        Effect.provide(Layer.merge(llmLayer, RATIONALE_TOOL_LAYER)),
      ),
    );

    const issuedRetry = prompts.some((p) => p.includes("STRICT RETRY"));
    expect(issuedRetry).toBe(true);
  }, 30000);

  it("should track token usage and cost across plan-execute-reflect cycle", async () => {
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: makePlanJson([
        {
          title: "Look up answer",
          instruction: "Find the answer",
          type: "analysis",
        },
      ]) },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: The answer is 42." },
      { match: "GOAL:", text: "SATISFIED: Task fully addressed." },
      { match: "Synthesize", text: "The answer is 42." },
    ]);

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

    const llmLayer = TestLLMServiceLayer([
      { match: "planning agent", text: TOOL_AND_ANALYSIS_PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary of the search results." },
      { match: "GOAL:", text: "SATISFIED: All steps completed." },
      { match: "Synthesize", text: "The synthesized final answer from search results." },
    ]);

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
    // TWO analysis steps: a single-analysis plan now short-circuits (no per-step
    // kernel execution), so the kernel-execution path for analysis steps is
    // exercised with a multi-step plan.
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: makePlanJson([
        {
          title: "Analyze data",
          instruction: "Perform deep analysis of the data",
          type: "analysis",
        },
        {
          title: "Summarize analysis",
          instruction: "Summarize the deep analysis",
          type: "analysis",
        },
      ]) },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Deep analysis shows positive trends." },
      { match: "GOAL:", text: "SATISFIED: Analysis complete." },
      { match: "Synthesize", text: "Analysis reveals positive trends in the data." },
    ]);

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
    // Should have executed the analysis steps via kernel
    const execSteps = result.steps.filter((s) =>
      s.content.startsWith("[EXEC"),
    );
    expect(execSteps.length).toBe(2);
    expect(execSteps[0]!.content).toContain("Deep analysis");
  });

  it("should unwrap shell-execute fullOutput in direct tool_call steps", async () => {
    const mockToolService = {
      execute: (_input: {
        toolName: string;
        arguments: Record<string, unknown>;
        agentId: string;
        sessionId: string;
      }) =>
        Effect.succeed({
          success: true,
          result: {
            executed: true,
            output: "[{\"sha\":\"only-first\"",
            fullOutput:
              '[{"sha":"a1","commit":{"message":"m1"}},{"sha":"a2","commit":{"message":"m2"}}]',
            truncated: true,
            exitCode: 0,
          },
        }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test",
          parameters: [{ name: "command", type: "string", required: true }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    };

    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of(mockToolService),
    );

    const shellPlan = makePlanJson([
      {
        title: "Fetch commits",
        instruction: "Get commits",
        type: "tool_call",
        toolName: "shell-execute",
        toolArgs: { command: "gh api repos/x/y/commits?per_page=5" },
      },
    ]);

    const llmLayer = TestLLMServiceLayer([
      { match: "planning agent", text: shellPlan },
      { match: "GOAL:", text: "SATISFIED: Step completed." },
      { match: "Synthesize", text: "Synthesized from full shell output." },
    ]);

    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Fetch commits",
        taskType: "research",
        memoryContext: "",
        availableTools: ["shell-execute"],
        availableToolSchemas: [
          {
            name: "shell-execute",
            description: "Run shell command",
            parameters: [
              { name: "command", type: "string", description: "command", required: true },
            ],
          },
        ],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llmLayer, toolLayer))),
    );

    const execStep = result.steps.find((s) => s.content.startsWith("[EXEC s1]"));
    expect(execStep).toBeDefined();
    // Ensure the unwrapped fullOutput is carried, not just the truncated output wrapper.
    expect(execStep!.content).toContain('"sha":"a2"');
    expect(execStep!.content).toContain('"message":"m2"');
    expect(execStep!.content).not.toContain('only-first');
  });

  it("should unwrap nested stringified shell output for namespaced shell tool names", async () => {
    const mockToolService = {
      execute: (_input: {
        toolName: string;
        arguments: Record<string, unknown>;
        agentId: string;
        sessionId: string;
      }) =>
        Effect.succeed({
          success: true,
          result: JSON.stringify({
            result: {
              output: "[{\"sha\":\"truncated\"",
              fullOutput:
                '[{"sha":"b1","commit":{"message":"full-1"}},{"sha":"b2","commit":{"message":"full-2"}}]',
              truncated: true,
            },
          }),
        }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test",
          parameters: [{ name: "command", type: "string", required: true }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    };

    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of(mockToolService),
    );

    const shellPlan = makePlanJson([
      {
        title: "Fetch commits",
        instruction: "Get commits",
        type: "tool_call",
        toolName: "github/shell-execute",
        toolArgs: { command: "gh api repos/x/y/commits?per_page=5" },
      },
    ]);

    const llmLayer = TestLLMServiceLayer([
      { match: "planning agent", text: shellPlan },
      { match: "GOAL:", text: "SATISFIED: Step completed." },
      { match: "Synthesize", text: "Synthesized from full shell output." },
    ]);

    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Fetch commits",
        taskType: "research",
        memoryContext: "",
        availableTools: ["github/shell-execute"],
        availableToolSchemas: [
          {
            name: "github/shell-execute",
            description: "Run shell command",
            parameters: [
              { name: "command", type: "string", description: "command", required: true },
            ],
          },
        ],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llmLayer, toolLayer))),
    );

    const execStep = result.steps.find((s) => s.content.startsWith("[EXEC s1]"));
    expect(execStep).toBeDefined();
    expect(execStep!.content).toContain('"message":"full-2"');
    expect(execStep!.content).not.toContain('truncated');
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

    const llmLayer = TestLLMServiceLayer([
      { match: "planning agent", text: REFERENCE_PLAN },
      { match: "GOAL:", text: "SATISFIED: Data fetched and processed." },
      { match: "Synthesize", text: "Data was fetched and written to file." },
    ]);

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
    const layer = TestLLMServiceLayer([
      { match: "planning agent", text: makePlanJson([
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
      ]) },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Research findings are detailed." },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: Summary written." },
      { match: "GOAL:", text: "SATISFIED: Task complete." },
      { match: "Synthesize", text: "The final synthesized answer: Quantum computing is advancing rapidly with key breakthroughs." },
    ]);

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

  it("should respect UNSATISFIED verdict even when all steps completed", async () => {
    // First reflection returns UNSATISFIED, augment prompt generates a supplementary step,
    // second reflection returns SATISFIED.
    const augmentPlan = makePlanJson([
      {
        title: "Search for missing ETH price",
        instruction: "Search the web for ETH price",
        type: "tool_call",
        toolName: "web-search",
        toolArgs: { query: "ETH price" },
      },
    ]);

    let toolCalls: string[] = [];
    const mockToolService = {
      execute: (input: {
        toolName: string;
        arguments: Record<string, unknown>;
        agentId: string;
        sessionId: string;
      }) => {
        toolCalls.push(input.toolName);
        return Effect.succeed({
          result: `Results for ${input.toolName}: ${JSON.stringify(input.arguments)}`,
          success: true,
        });
      },
      getTool: (name: string) =>
        Effect.succeed({ name, description: "test", parameters: [] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    };

    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of(mockToolService),
    );

    let reflectionCount = 0;
    const llmLayer = TestLLMServiceLayer([
      {
        match: "planning agent",
        text: makePlanJson([
          {
            title: "Search XRP price",
            instruction: "Search for XRP price",
            type: "tool_call",
            toolName: "web-search",
            toolArgs: { query: "XRP price" },
          },
        ]),
      },
      {
        match: "GOAL:",
        text: "UNSATISFIED: Missing ETH price. Only XRP was found.",
      },
      {
        match: "supplementary",
        text: augmentPlan,
      },
      {
        match: "GOAL:",
        text: "SATISFIED: All prices found.",
      },
      {
        match: "Synthesize",
        text: "XRP: $0.52, ETH: $3200.",
      },
    ]);

    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Get prices of XRP and ETH",
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
      }).pipe(Effect.provide(Layer.merge(llmLayer, toolLayer))),
    );

    expect(result.status).toBe("completed");
    // Should have executed 2 tool calls: original + augmented
    expect(toolCalls.length).toBe(2);
    expect(toolCalls).toEqual(["web-search", "web-search"]);
    // Should have AUGMENT step
    const augmentStep = result.steps.find((s) => s.content.includes("[AUGMENT]"));
    expect(augmentStep).toBeDefined();
  });

  it("should inject synthetic steps when requiredToolQuantities deficit exists", async () => {
    let toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const mockToolService = {
      execute: (input: {
        toolName: string;
        arguments: Record<string, unknown>;
        agentId: string;
        sessionId: string;
      }) => {
        toolCalls.push({ toolName: input.toolName, args: input.arguments });
        return Effect.succeed({
          result: `Price data for ${JSON.stringify(input.arguments)}`,
          success: true,
        });
      },
      getTool: (name: string) =>
        Effect.succeed({ name, description: "test", parameters: [] }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    };

    const toolLayer = Layer.succeed(
      ToolService,
      ToolService.of(mockToolService),
    );

    // Plan only has 1 web-search step, but quantities require 3
    const llmLayer = TestLLMServiceLayer([
      {
        match: "planning agent",
        text: makePlanJson([
          {
            title: "Search all prices",
            instruction: "Search for all crypto prices",
            type: "tool_call",
            toolName: "web-search",
            toolArgs: { query: "all crypto prices" },
          },
        ]),
      },
      { match: "GOAL:", text: "SATISFIED: All found." },
      { match: "Synthesize", text: "Prices: XRP, ETH, BTC." },
    ]);

    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Get prices of XRP, ETH, and BTC",
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
        requiredToolQuantities: { "web-search": 3 },
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llmLayer, toolLayer))),
    );

    expect(result.status).toBe("completed");
    // Plan had 1 step + 2 injected synthetic = 3 web-search calls
    expect(toolCalls.length).toBeGreaterThanOrEqual(3);
    expect(toolCalls.filter((c) => c.toolName === "web-search").length).toBeGreaterThanOrEqual(3);
  });

  it("should enforce markdown table output format when task requests one", async () => {
    const layer = TestLLMServiceLayer([
      {
        match: "planning agent",
        text: makePlanJson([
          {
            title: "Summarize commit data",
            instruction: "Summarize commit data",
            type: "analysis",
          },
        ]),
      },
      { match: "OVERALL GOAL", text: "This is plain prose and not a markdown table." },
      { match: "GOAL:", text: "SATISFIED: Task complete." },
      { match: "Synthesize", text: "Still prose and not a table." },
      {
        match: "They requested the output as: markdown",
        text: "| Commit Message | Author | Date |\n|---|---|---|\n| fix: test | Tyler | 2026-03-29 |",
      },
    ]);

    const result = await Effect.runPromise(
      executePlanExecute({
        taskDescription:
          "Render a markdown table with columns Commit Message, Author, Date from the commit data.",
        taskType: "analysis",
        memoryContext: "",
        availableTools: [],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    );

    expect(result.status).toBe("completed");
    expect(String(result.output)).toContain("| Commit Message | Author | Date |");
    expect(String(result.output)).toContain("|---|---|---|");
  });
});
