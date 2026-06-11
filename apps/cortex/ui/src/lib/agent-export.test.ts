import { describe, it, expect } from "bun:test";
import { generateAgentTs, generateAgentJson } from "./agent-export.js";
import { defaultConfig } from "./types/agent-config.js";

describe("generateAgentTs", () => {
  it("emits a runnable builder chain mirroring the config", () => {
    const cfg = {
      ...defaultConfig(),
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      temperature: 0.5,
      maxIterations: 12,
      systemPrompt: "You are helpful.",
      strategy: "plan-execute-reflect" as const,
      tools: ["web-search", "http-get"],
    };
    const ts = generateAgentTs(cfg, "Research Bot");
    expect(ts).toContain("import { ReactiveAgents } from \"reactive-agents\"");
    expect(ts).toContain("ReactiveAgents.create()");
    expect(ts).toContain('.withName("Research Bot")');
    expect(ts).toContain('.withProvider("anthropic")');
    expect(ts).toContain('.withModel(');
    expect(ts).toContain('"claude-sonnet-4-6"');
    expect(ts).toContain("temperature: 0.5");
    expect(ts).toContain('.withSystemPrompt("You are helpful.")');
    expect(ts).toContain('.withReasoning({ defaultStrategy: "plan-execute-reflect" })');
    expect(ts).toContain(".withMaxIterations(12)");
    expect(ts).toContain('.withTools({ tools: ["web-search", "http-get"] })');
    expect(ts).toContain(".build()");
    expect(ts).toContain("agent.run(");
  });

  it("escapes quotes and newlines in the system prompt", () => {
    const cfg = { ...defaultConfig(), systemPrompt: 'Say "hi"\nthen stop' };
    const ts = generateAgentTs(cfg, "x");
    expect(ts).toContain('Say \\"hi\\"\\nthen stop');
    // no raw newline injected into the string literal
    expect(ts).not.toContain('Say "hi"\nthen stop');
  });

  it("omits optional clauses when at defaults", () => {
    const cfg = { ...defaultConfig(), systemPrompt: "", tools: [] };
    const ts = generateAgentTs(cfg, "Bare");
    expect(ts).not.toContain(".withSystemPrompt(");
    expect(ts).not.toContain(".withReasoning(");
    expect(ts).toContain(".withTools()");
  });

  it("includes auditRationale in withReasoning when enabled", () => {
    const cfg = { ...defaultConfig(), auditRationale: true, strategy: "reactive" as const };
    const ts = generateAgentTs(cfg, "Audited");
    expect(ts).toContain("auditRationale: true");
  });

  it("adds withMemory / withHealthCheck / guardrails when enabled", () => {
    const cfg = {
      ...defaultConfig(),
      memory: { working: true, episodic: true, semantic: false },
      healthCheck: true,
      guardrails: { enabled: true, injectionThreshold: 0.5, piiThreshold: 0, toxicityThreshold: 0 },
    };
    const ts = generateAgentTs(cfg, "Full");
    expect(ts).toContain(".withMemory(");
    expect(ts).toContain(".withHealthCheck()");
    expect(ts).toContain(".withGuardrails(");
  });

  it("does not crash on a sparse/legacy config missing newer fields", () => {
    // Gateway cards pass stored configs that may predate auditRationale / tools / strategy.
    const sparse = { provider: "ollama", model: "qwen3:4b" } as unknown as Parameters<typeof generateAgentTs>[0];
    const ts = generateAgentTs(sparse, "Legacy Agent");
    expect(ts).toContain('.withProvider("ollama")');
    expect(ts).toContain('.withModel("qwen3:4b")');
    expect(ts).toContain(".withTools()");
    expect(ts).toContain(".build()");
  });
});

describe("generateAgentJson", () => {
  it("serializes the config as pretty JSON", () => {
    const cfg = { ...defaultConfig(), model: "claude-sonnet-4-6" };
    const json = generateAgentJson(cfg, "Bot");
    const parsed = JSON.parse(json) as { name: string; config: { model: string } };
    expect(parsed.name).toBe("Bot");
    expect(parsed.config.model).toBe("claude-sonnet-4-6");
  });
});
