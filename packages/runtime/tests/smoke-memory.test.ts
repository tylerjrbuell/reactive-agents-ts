import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("Smoke: Memory Integration", () => {
  it("agent with memory tier 1 completes bootstrap + flush", async () => {
    const agent = await ReactiveAgents.create()
      .withName("memory-t1")
      .withProvider("test")
      .withMemory("1")
      .withTestResponses({ default: "Memory test response." })
      .build();

    const result = await agent.run("Hello with memory");
    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it("multi-turn: two sequential agent.run() calls succeed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("memory-multi")
      .withProvider("test")
      .withMemory("1")
      .withTestResponses({ default: "Turn response." })
      .build();

    const result1 = await agent.run("First question");
    expect(result1.success).toBe(true);

    const result2 = await agent.run("Second question");
    expect(result2.success).toBe(true);
  });

  it("memory + reasoning combination works", async () => {
    const agent = await ReactiveAgents.create()
      .withName("memory-reasoning")
      .withProvider("test")
      .withMemory("1")
      .withTestResponses({ default: "FINAL ANSWER: Memory and reasoning combined." })
      .withReasoning()
      .build();

    const result = await agent.run("Remember this");
    expect(result.success).toBe(true);
  });
});
