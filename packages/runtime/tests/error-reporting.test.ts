import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import type { AgentEvent } from "@reactive-agents/core";

/** AgentCompleted with the error field we added (may not be in compiled .d.ts yet). */
type AgentCompletedWithError = Extract<AgentEvent, { _tag: "AgentCompleted" }> & { error?: string };

describe("Error reporting chain", () => {
  it("AgentResult reports honest failure when loop fires with no substantive output (HS-106)", async () => {
    // Empty-response loops produce only thought steps (no action steps).
    // Loop detection trips after `maxConsecutiveThoughts` (default 3).
    // Pre-HS-106 the runtime returned success:true with the empty / harness-
    // injected text as a "graceful degradation" — direct anti-mission #4
    // violation (a system that hides failure). HS-106 invariant: strategy
    // result with null/empty output is forced to status=failed at
    // buildStrategyResult, so the runtime correctly reports success:false.
    const agent = await ReactiveAgents.create()
      .withName("error-test-agent")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 8, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Test task");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    await agent.dispose();
  });

  it("AgentResult has no error field on success", async () => {
    const agent = await ReactiveAgents.create()
      .withName("success-test-agent")
      .withTestScenario([{ text: "The answer is 42." }])
      .build();

    const result = await agent.run("What is the meaning of life?");

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    await agent.dispose();
  });

  it("AgentCompleted event fires with success:false on empty-output loop (HS-106)", async () => {
    const collectedEvents: AgentEvent[] = [];

    const agent = await ReactiveAgents.create()
      .withName("event-error-test")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 8, temperature: 0.7 } } })
      .build();

    // Subscribe before run — events are fire-and-forget during execution
    const unsub = await agent.subscribe((event) => {
      collectedEvents.push(event);
    });

    await agent.run("Test task");
    unsub();

    const completedEvent = collectedEvents.find(
      (e) => e._tag === "AgentCompleted",
    ) as AgentCompletedWithError | undefined;

    // HS-106: pure thought loop with empty output is an honest failure,
    // not a "graceful degradation" disguised as success.
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.success).toBe(false);
    expect(completedEvent!.error).toBeDefined();
    await agent.dispose();
  });

  it("AgentCompleted event has no error on success", async () => {
    const collectedEvents: AgentEvent[] = [];

    const agent = await ReactiveAgents.create()
      .withName("event-success-test")
      .withTestScenario([{ text: "Simple answer." }])
      .build();

    const unsub = await agent.subscribe((event) => {
      collectedEvents.push(event);
    });

    await agent.run("Test task");
    unsub();

    const completedEvent = collectedEvents.find(
      (e) => e._tag === "AgentCompleted",
    ) as AgentCompletedWithError | undefined;

    expect(completedEvent).toBeDefined();
    expect(completedEvent!.success).toBe(true);
    expect(completedEvent!.error).toBeUndefined();
    await agent.dispose();
  });

  it("error field is string type on AgentResult interface", () => {
    // Type-level check — verify the error field compiles
    const mockResult: import("../src/builder.js").AgentResult = {
      output: "",
      success: false,
      taskId: "t1",
      agentId: "a1",
      metadata: {
        duration: 0,
        cost: 0,
        tokensUsed: 0,
        strategyUsed: "reactive",
        stepsCount: 0,
      },
      error: "Test error message",
    };
    expect(mockResult.error).toBe("Test error message");
  });

  it("hard LLM failure surfaces as success:false result (not silent swallow)", async () => {
    // When the LLM stream emits an error event, agent.run() returns a failed result.
    // The API contract is: run() always returns AgentResult — check result.success.
    const agent = await ReactiveAgents.create()
      .withName("hard-fail-test")
      .withTestScenario([{ error: "Connection refused" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const result = await agent.run("Test task");
    expect(result.success).toBe(false);
    await agent.dispose();
  });
});

describe("metadata instrumentation", () => {
  it("result.metadata.llmCalls reflects actual LLM API calls made", async () => {
    const agent = await ReactiveAgents.create()
      .withName("llm-calls-test")
      .withTestScenario([{ text: "The answer is 42." }])
      .withReasoning({ defaultStrategy: "reactive", maxIterations: 5 })
      .build();

    const result = await agent.run("What is the answer?");
    expect((result.metadata as any).llmCalls).toBeGreaterThan(0);
    await agent.dispose();
  });
});
