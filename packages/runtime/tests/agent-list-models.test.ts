// Run: bun test packages/runtime/tests/agent-list-models.test.ts --timeout 15000
//
// Phase E Task 5 - agent.listModels() public facade method tests.
// Tests three scenarios:
//   (a) listModels() with .withJudgment() configured returns models from jev backend
//   (b) listModels() without .withJudgment() throws "JudgmentService is not configured"
//   (c) listModels() with llm backend (no catalog) surfaces JudgmentUnsupported error

import { describe, it, expect, afterEach } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { JudgmentUnsupported, type JudgmentModel } from "@reactive-agents/judgment";

describe("agent.listModels() - Phase E Task 5", () => {
  const agentsToDispose: Array<{ dispose: () => Promise<void> }> = [];
  afterEach(async () => {
    while (agentsToDispose.length > 0) {
      await agentsToDispose.pop()!.dispose();
    }
  });

  it("(a) listModels() with .withJudgment() configured returns model list from jev backend", async () => {
    const agent = await ReactiveAgents.create()
      .withName("list-models-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withJudgment({ backend: "jev" })
      .build();
    agentsToDispose.push(agent);

    const models = await agent.listModels();

    // Verify that listModels() returns an array of models with expected structure
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Verify each model has the expected properties
    for (const model of models) {
      expect(typeof model.name).toBe("string");
      expect(typeof model.description).toBe("string");
      expect(typeof model.releaseDate).toBe("string");
      expect(model.name.length).toBeGreaterThan(0);
    }
  });

  it("(b) listModels() without .withJudgment() throws immediately", async () => {
    const agent = await ReactiveAgents.create()
      .withName("list-models-no-judgment-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();
    agentsToDispose.push(agent);

    let error: Error | null = null;
    try {
      await agent.listModels();
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain("agent.listModels() requires .withJudgment()");
    expect(error?.message).toContain("JudgmentService is not configured");
  });

  it("(c) listModels() with llm backend (no catalog) surfaces JudgmentUnsupported error", async () => {
    const agent = await ReactiveAgents.create()
      .withName("list-models-unsupported-agent")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .withJudgment({ backend: "llm" })
      .build();
    agentsToDispose.push(agent);

    let error: Error | null = null;
    try {
      await agent.listModels();
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
    }

    expect(error).not.toBeNull();
    expect(
      error instanceof JudgmentUnsupported ||
        error?.message.includes("JudgmentUnsupported") ||
        error?.message.includes("no model catalog")
    ).toBe(true);
  });
});
