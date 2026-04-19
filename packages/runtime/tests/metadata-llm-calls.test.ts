import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

/**
 * Regression tests for metadata.llmCalls counter.
 *
 * Two code paths must both report a non-zero count:
 *   1. Direct-LLM path  — no withReasoning(), engine drives the LLM loop directly
 *   2. ReasoningService path — withReasoning() routes through kernel/reactive strategy
 */

describe("metadata.llmCalls", () => {
  it("counts LLM invocations on the direct-LLM path (no withReasoning)", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: ".*", text: "ok" }])
      .build();

    const result = await agent.run("hello");
    expect((result.metadata as any).llmCalls).toBeGreaterThan(0);
    await agent.dispose();
  });

  it("counts LLM invocations on the ReasoningService path (withReasoning)", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ match: ".*", text: "ok" }])
      .withReasoning({ defaultStrategy: "reactive", maxIterations: 5 })
      .build();

    const result = await agent.run("hello");
    expect((result.metadata as any).llmCalls).toBeGreaterThan(0);
    await agent.dispose();
  });
});
