import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import {
  synthesizeDebrief,
  formatDebriefMarkdown,
  type DebriefInput,
  type AgentDebrief,
} from "../src/debrief.js";
import { createTestLLMServiceLayer } from "@reactive-agents/testing";
import { ReactiveAgents } from "../src/index.js";
import type { AgentEvent } from "@reactive-agents/core";
import { FallbackChain } from "../../llm-provider/src/fallback-chain.js";

const baseInput: DebriefInput = {
  taskPrompt: "Fetch commits and send Signal message",
  agentId: "test-agent",
  taskId: "task-123",
  terminatedBy: "final_answer_tool",
  finalAnswerCapture: {
    output: "Message sent successfully",
    format: "text",
    summary: "Fetched 5 commits and sent Signal message",
    confidence: "high",
  },
  toolCallHistory: [
    { name: "github/list_commits", calls: 1, errors: 0, avgDurationMs: 200 },
    { name: "signal/send_message_to_user", calls: 1, errors: 0, avgDurationMs: 100 },
  ],
  errorsFromLoop: [],
  metrics: { tokens: 5000, duration: 12000, iterations: 5, cost: 0 },
};

describe("synthesizeDebrief", () => {
  it("produces a valid AgentDebrief with all required fields", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({
          summary: "Agent fetched 5 commits and sent a Signal message successfully.",
          keyFindings: ["5 commits retrieved", "message delivered"],
          errorsEncountered: [],
          lessonsLearned: ["github/list_commits works reliably for this repo"],
          caveats: "",
        }),
        stopReason: "end_turn" as const,
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief(baseInput).pipe(Effect.provide(llmLayer))
    );

    expect(debrief.outcome).toBe("success");
    expect(typeof debrief.summary).toBe("string");
    expect(debrief.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(debrief.keyFindings)).toBe(true);
    expect(Array.isArray(debrief.errorsEncountered)).toBe(true);
    expect(Array.isArray(debrief.lessonsLearned)).toBe(true);
    expect(debrief.toolsUsed).toHaveLength(2);
    expect(debrief.metrics.tokens).toBe(5000);
    expect(debrief.metrics.duration).toBe(12000);
    expect(debrief.metrics.iterations).toBe(5);
    expect(debrief.confidence).toBe("high");
    expect(typeof debrief.markdown).toBe("string");
    expect(debrief.markdown.length).toBeGreaterThan(0);
  });

  it("sets outcome to partial when terminated by max_iterations", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({
          summary: "Partial completion — hit iteration limit.",
          keyFindings: [],
          errorsEncountered: ["Hit iteration limit"],
          lessonsLearned: [],
          caveats: "Did not complete all steps",
        }),
        stopReason: "end_turn" as const,
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief({
        ...baseInput,
        terminatedBy: "max_iterations",
        finalAnswerCapture: undefined,
      }).pipe(Effect.provide(llmLayer))
    );

    expect(debrief.outcome).toBe("partial");
  });

  it("falls back gracefully when LLM returns malformed JSON", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: "This is not JSON at all",
        stopReason: "end_turn" as const,
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief(baseInput).pipe(Effect.provide(llmLayer))
    );

    // Should not throw — falls back to agent self-report
    expect(debrief.outcome).toBe("success");
    expect(typeof debrief.summary).toBe("string");
    expect(debrief.summary.length).toBeGreaterThan(0);
  });

  it("strips markdown fences from LLM response before parsing", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: "```json\n" + JSON.stringify({
          summary: "Done.",
          keyFindings: ["thing 1"],
          errorsEncountered: [],
          lessonsLearned: [],
          caveats: "",
        }) + "\n```",
        stopReason: "end_turn" as const,
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief(baseInput).pipe(Effect.provide(llmLayer))
    );

    expect(debrief.summary).toBe("Done.");
    expect(debrief.keyFindings).toEqual(["thing 1"]);
  });

  it("calculates tool successRate correctly", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({ summary: "done", keyFindings: [], errorsEncountered: [], lessonsLearned: [], caveats: "" }),
        stopReason: "end_turn" as const,
      },
    ]);

    const inputWithErrors: DebriefInput = {
      ...baseInput,
      toolCallHistory: [
        { name: "web-search", calls: 4, errors: 1, avgDurationMs: 300 },
      ],
    };

    const debrief = await Effect.runPromise(
      synthesizeDebrief(inputWithErrors).pipe(Effect.provide(llmLayer))
    );

    expect(debrief.toolsUsed[0]?.name).toBe("web-search");
    expect(debrief.toolsUsed[0]?.successRate).toBeCloseTo(0.75);
  });

  it("handles missing finalAnswerCapture when finalOutputText is substantive", async () => {
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({
          summary: "Provided a repository description from fetched README content.",
          keyFindings: ["README content summarized"],
          errorsEncountered: [],
          lessonsLearned: [],
          caveats: "",
        }),
        stopReason: "end_turn" as const,
      },
    ]);

    const input: DebriefInput = {
      ...baseInput,
      finalAnswerCapture: undefined,
      finalOutputText:
        "# reactive-agents-ts\n\nEffect-TS agent framework with layered runtime and tools.",
    };

    const debrief = await Effect.runPromise(
      synthesizeDebrief(input).pipe(Effect.provide(llmLayer)),
    );

    expect(debrief.outcome).toBe("success");
    expect(debrief.confidence).toBe("high");
    expect(debrief.summary).toContain("repository");
  });

  it("truncates very long finalOutputText without throwing", async () => {
    const longBody = "x".repeat(20_000);
    const llmLayer = createTestLLMServiceLayer([
      {
        content: JSON.stringify({
          summary: "ok",
          keyFindings: [],
          errorsEncountered: [],
          lessonsLearned: [],
          caveats: "",
        }),
        stopReason: "end_turn" as const,
      },
    ]);

    const debrief = await Effect.runPromise(
      synthesizeDebrief({
        ...baseInput,
        finalAnswerCapture: undefined,
        finalOutputText: longBody,
      }).pipe(Effect.provide(llmLayer)),
    );

    expect(debrief.summary).toBe("ok");
    expect(debrief.markdown.length).toBeGreaterThan(0);
  });
});

describe("formatDebriefMarkdown", () => {
  const sampleDebrief: Omit<AgentDebrief, "markdown"> = {
    outcome: "success",
    summary: "Did the thing",
    keyFindings: ["finding 1", "finding 2"],
    errorsEncountered: [],
    lessonsLearned: ["lesson 1"],
    confidence: "high",
    caveats: undefined,
    toolsUsed: [{ name: "web-search", calls: 2, successRate: 1 }],
    metrics: { tokens: 1000, duration: 5000, iterations: 3, cost: 0.001 },
  };

  it("renders all sections", () => {
    const md = formatDebriefMarkdown(sampleDebrief);
    expect(md).toContain("## Summary");
    expect(md).toContain("## Key Findings");
    expect(md).toContain("## Tools Used");
    expect(md).toContain("## Metrics");
    expect(md).toContain("web-search");
    expect(md).toContain("Did the thing");
    expect(md).toContain("finding 1");
    expect(md).toContain("lesson 1");
  });

  it("omits empty sections", () => {
    const md = formatDebriefMarkdown({ ...sampleDebrief, keyFindings: [], lessonsLearned: [], errorsEncountered: [] });
    expect(md).not.toContain("## Key Findings");
    expect(md).not.toContain("## Lessons Learned");
    expect(md).not.toContain("## Errors Encountered");
  });

  it("includes caveats when present", () => {
    const md = formatDebriefMarkdown({ ...sampleDebrief, caveats: "Some uncertainty here" });
    expect(md).toContain("## Caveats");
    expect(md).toContain("Some uncertainty here");
  });
});

describe("DebriefCompleted event emission", () => {
  it("publishes DebriefCompleted after successful run debrief synthesis", async () => {
    const agent = await ReactiveAgents.create()
      .withName("debrief-event-test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withMemory()
      .build();

    const published: AgentEvent[] = [];
    const unsubscribe = await agent.subscribe((event) => {
      published.push(event);
    });

    await agent.run("Say done");

    unsubscribe();
    await agent.dispose();

    expect(published.some((event) => event._tag === "DebriefCompleted")).toBe(true);
  });
});

describe("ProviderFallbackActivated event shape", () => {
  it("can be published when a fallback callback triggers", () => {
    const published: AgentEvent[] = [];
    const chain = new FallbackChain(
      { providers: ["anthropic", "openai"], errorThreshold: 1 },
      (from: string, to: string, reason: string, attempt: number) => {
        published.push({
          _tag: "ProviderFallbackActivated",
          taskId: "test-task",
          fromProvider: from,
          toProvider: to,
          reason,
          attemptNumber: attempt,
        });
      },
    );

    chain.recordError("anthropic");
    expect(published.some((event) => event._tag === "ProviderFallbackActivated")).toBe(true);
  });
});
