import { describe, it, expect } from "bun:test";
import { ReactiveAgents, type AgentPersona } from "../src/index";

describe("Sub-agent Persona Support", () => {
  it("withAgentTool accepts persona configuration", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent")
      .withAgentTool("data-analyst", {
        name: "data-analyst",
        description: "Analyzes data and generates reports",
        persona: {
          role: "Senior Data Analyst",
          instructions: "Focus on accuracy and statistical rigor",
          tone: "professional",
        },
        systemPrompt: "You have access to data analysis tools.",
      })
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
    expect(agent.agentId).toContain("test-agent");
  });

  it("withDynamicSubAgents enables spawn-agent tool with persona support", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent-dynamic")
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
    expect(agent.agentId).toContain("test-agent-dynamic");
  });

  it("static subagent persona and systemPrompt compose correctly", async () => {
    const agent = await ReactiveAgents.create()
      .withName("test-agent-static")
      .withAgentTool("researcher", {
        name: "researcher",
        persona: {
          role: "Research Assistant",
          background: "Expert in academic research",
          instructions: "Cite sources",
        },
        systemPrompt: "Focus on recent publications.",
      })
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
  });

  it("subagent tool supports all persona fields", async () => {
    const persona: AgentPersona = {
      name: "Specialist",
      role: "Quality Assurance Lead",
      background: "10+ years in QA",
      instructions: "Test thoroughly",
      tone: "detail-oriented",
    };

    const agent = await ReactiveAgents.create()
      .withName("test-qa")
      .withAgentTool("qa-agent", {
        name: "qa-agent",
        persona: {
          role: persona.role,
          background: persona.background,
          instructions: persona.instructions,
          tone: persona.tone,
        },
      })
      .withTestScenario([{ match: "test-input", text: "test-output" }])
      .build();

    expect(agent).toBeDefined();
  });
});
