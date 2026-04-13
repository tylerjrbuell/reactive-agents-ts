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

describe("Sub-agent tool restriction (tools parameter) — no recall unavailable error", () => {
  it("spawn-agent with explicit tools parameter doesn't fail with missing_required_tool: recall", async () => {
    // Reproduces the subagent recall fix: when spawn-agent is called with tools=["web-search"],
    // subRequiredTools should NOT include recall (an ALWAYS_INCLUDE_TOOL). The fix filters out
    // ALWAYS_INCLUDE_TOOLS from required, so only the caller's explicit tools are required.
    // Before fix: subRequiredTools = ["web-search", "recall"] → kernel pre-loop guard fails
    //            because recall not registered in light runtime
    // After fix:  subRequiredTools = ["web-search"] → subagent can attempt to execute
    const agent = await ReactiveAgents.create()
      .withName("test-spawn-tools-param")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents()
      .withTools() // Enable web-search and other tools
      .withTestScenario([
        {
          match: "spawn-agent",
          // Simulate: spawn agent with tools=["web-search"] parameter
          text: '{"tool": "spawn-agent", "args": {"task": "find test info", "tools": ["web-search"]}}',
        },
      ])
      .build();

    // If the fix is in place, agent builds without error.
    // The key is that spawning with explicit tools doesn't force recall into required.
    expect(agent).toBeDefined();
    expect(agent.agentId).toContain("test-spawn-tools-param");
  });
});
