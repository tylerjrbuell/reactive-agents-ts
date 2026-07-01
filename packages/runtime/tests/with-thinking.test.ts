import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "reactive-agents";

describe(".withThinking() writes config.thinkingOptions + config.thinking", () => {
  it("bare call enables thinking", async () => {
    const agent = await ReactiveAgents.create().withProvider("anthropic").withThinking().build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinking).toBe(true);
    expect(cfg.thinkingOptions).toMatchObject({ enabled: true });
  }, 15000);

  it("carries effort + budgetTokens", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("openai")
      .withThinking({ effort: "high", budgetTokens: 8000 })
      .build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinkingOptions).toMatchObject({ enabled: true, effort: "high", budgetTokens: 8000 });
  }, 15000);

  it("withThinking(false) disables", async () => {
    const agent = await ReactiveAgents.create().withProvider("gemini").withThinking(false).build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinking).toBe(false);
    expect(cfg.thinkingOptions).toMatchObject({ enabled: false });
  }, 15000);

  it(".withModel({thinking:true}) still works (quick boolean, unchanged)", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("anthropic")
      .withModel({ thinking: true })
      .build();
    const cfg = (agent as unknown as { config: Record<string, unknown> }).config;
    expect(cfg.thinking).toBe(true);
  }, 15000);
});
