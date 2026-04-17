import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import type { AgentEvent } from "@reactive-agents/core";

/** AgentCompleted with the error field we added (may not be in compiled .d.ts yet). */
type AgentCompletedWithError = Extract<AgentEvent, { _tag: "AgentCompleted" }> & { error?: string };

describe("Error reporting chain", () => {
  it("AgentResult succeeds gracefully when loop fires on pure thought steps", async () => {
    // Empty-response loops produce only thought steps (no action steps).
    // Loop detection now degrades gracefully → success: true with last thought as output.
    const agent = await ReactiveAgents.create()
      .withName("error-test-agent")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 1, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Test task");

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
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

  it("AgentCompleted event fires with success:true on graceful loop degradation", async () => {
    const collectedEvents: AgentEvent[] = [];

    const agent = await ReactiveAgents.create()
      .withName("event-error-test")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 1, temperature: 0.7 } } })
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

    // Pure thought loop → graceful degradation → success:true, no error surfaced
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.success).toBe(true);
    expect(completedEvent!.error).toBeUndefined();
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

  it("hard LLM failure rejects the promise (not silent swallow)", async () => {
    // When the LLM provider throws outright, the promise should reject, not hang.
    const agent = await ReactiveAgents.create()
      .withName("hard-fail-test")
      .withTestScenario([{ error: "Connection refused" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    let threwError = false;
    try {
      await agent.run("Test task");
    } catch (e) {
      threwError = true;
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain("Connection refused");
    }
    expect(threwError).toBe(true);
    await agent.dispose();
  });
});
