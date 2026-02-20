import { describe, it, expect } from "bun:test";
import {
  ReactiveAgents,
  ReactiveAgentBuilder,
  ReactiveAgent,
} from "../src/index.js";

describe("ReactiveAgentBuilder", () => {
  it("should create a builder via ReactiveAgents.create()", () => {
    const builder = ReactiveAgents.create();
    expect(builder).toBeInstanceOf(ReactiveAgentBuilder);
  });

  it("should build a ReactiveAgent with test provider", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withModel("test-model")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
    expect(agent.agentId).toContain("test-agent");
  });

  it("should run a task and return AgentResult", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withModel("test-model")
      .withTestResponses({
        "What is 2+2": "The answer is 4.",
      })
      .build();

    const result = await agent.run("What is 2+2?");

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
    expect(result.agentId).toContain("test-agent");
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata.duration).toBe("number");
    expect(typeof result.metadata.stepsCount).toBe("number");
  });

  it("should support max iterations configuration", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withProvider("test")
      .withMaxIterations(5)
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });
});
