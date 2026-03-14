import { describe, it, expect } from "bun:test";
import { ReactiveAgents, type AgentPersona } from "../src/index";

describe("Agent Persona / Steering API", () => {
  it("withPersona() builder method works", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withPersona({
        role: "Senior Software Engineer",
        background: "Expert in TypeScript and distributed systems",
        instructions: "Always explain your reasoning step by step",
        tone: "professional and concise",
      })
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
    expect(agent.agentId).toContain("test-agent");
  });

  it("withPersona() + withSystemPrompt() composition works", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent-2")
      .withPersona({
        role: "Data Scientist",
        instructions: "Use Python and R",
      })
      .withSystemPrompt("Additional context about this agent.")
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
  });

  it("withPersona() alone works", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent-3")
      .withPersona({
        role: "Product Manager",
        tone: "collaborative",
      })
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
  });

  it("AgentPersona type is correctly exported", async () => {
    // This is just a type check - if it compiles, it works
    const persona: AgentPersona = {
      name: "Test Agent",
      role: "Test Role",
      background: "Test Background",
      instructions: "Test Instructions",
      tone: "test",
    };
    expect(persona).toBeDefined();
  });
});
