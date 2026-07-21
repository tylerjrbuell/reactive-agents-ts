// Run: bun test packages/runtime/tests/create-agent.test.ts --timeout 15000
//
// createAgent(config) — the declarative front door. Pins:
//   1. It builds a ReactiveAgent (5-line quickstart works offline).
//   2. Equivalence (DP7): createAgent(cfg) and the fluent chain that sets the
//      same keys produce byte-identical toConfig() — same single source.
//   3. Q6 profile: {profile:"balanced", ...overrides} == balanced() + overrides
//      (profile applied FIRST, siblings win on conflict).
//   4. DP6: unknown keys are rejected loudly with the path named.
import { describe, it, expect } from "bun:test";
import { ReactiveAgent } from "../src/reactive-agent.js";
import { ReactiveAgents } from "../src/builder.js";
import { createAgent } from "../src/create-agent.js";
import { agentConfigToBuilder, type AgentConfig } from "../src/agent-config.js";
import { HarnessProfile } from "../src/capabilities/profile.js";

describe("createAgent", () => {
  it("builds a ReactiveAgent from a minimal declarative config (offline)", async () => {
    const agent = await createAgent({
      name: "quickstart",
      provider: "test",
      model: "test-model",
      tools: { allowedTools: ["file-read"] },
    });
    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("equivalence (DP7): createAgent(cfg) toConfig() ≡ fluent chain toConfig()", async () => {
    const cfg: AgentConfig = {
      name: "researcher",
      provider: "anthropic",
      model: "claude-opus-4-8",
      systemPrompt: "You are careful.",
      tools: { allowedTools: ["web-search", "file-write"] },
      verification: { useLLMTier: false, onReject: "annotate" },
      budget: { tokenLimit: 100_000 },
    };

    // Declarative → builder (the createAgent path, pre-build()).
    const declarative = (await agentConfigToBuilder(cfg)).toConfig();

    // The fluent chain that sets the same keys.
    const fluent = ReactiveAgents.create()
      .withName("researcher")
      .withProvider("anthropic")
      .withModel("claude-opus-4-8")
      .withSystemPrompt("You are careful.")
      .withTools({ allowedTools: ["web-search", "file-write"] })
      .withVerification({ useLLMTier: false, onReject: "annotate" })
      .withBudget({ tokenLimit: 100_000 })
      .toConfig();

    expect(declarative).toEqual(fluent);
  });

  it("Q6: {profile:'balanced'} ≡ .withProfile(HarnessProfile.balanced())", async () => {
    const viaConfig = (
      await agentConfigToBuilder({
        name: "p",
        provider: "test",
        profile: "balanced",
      })
    ).toConfig();

    const viaWither = ReactiveAgents.create()
      .withName("p")
      .withProvider("test")
      .withProfile(HarnessProfile.balanced())
      .toConfig();

    expect(viaConfig).toEqual(viaWither);
  });

  it("Q6: profile is the BASELINE — explicit sibling keys override it", async () => {
    // lean() disables memory; an explicit memory key must win (re-enable it),
    // mirroring profile.ts "later calls override earlier patches".
    const viaConfig = (
      await agentConfigToBuilder({
        name: "p",
        provider: "test",
        profile: "lean",
        memory: { tier: "enhanced" },
      })
    ).toConfig();

    const viaWither = ReactiveAgents.create()
      .withName("p")
      .withProvider("test")
      .withProfile(HarnessProfile.lean())
      .withMemory({ tier: "enhanced" })
      .toConfig();

    expect(viaConfig).toEqual(viaWither);
    // Memory re-enabled despite the lean baseline.
    expect(viaConfig.memory?.tier).toBe("enhanced");
  });

  it("DP6: unknown config keys are rejected loudly", async () => {
    await expect(
      // @ts-expect-error — `modle` is a typo; the declarative surface rejects it.
      createAgent({ name: "x", provider: "test", modle: "oops" }),
    ).rejects.toThrow(/invalid config/i);
  });

  // The provider union is DERIVED from the canonical LLMProviderType (minus
  // "custom", plus "test") — a stale inline copy previously rejected groq/xai
  // from the declarative front door for two releases while the fluent builder
  // accepted them. Cut the derivation (re-inline a subset) and this goes red.
  it("accepts every canonical provider the builder accepts (groq/xai included)", async () => {
    for (const provider of [
      "anthropic",
      "openai",
      "ollama",
      "gemini",
      "litellm",
      "groq",
      "xai",
      "test",
    ] as const) {
      const agent = await createAgent({ name: `p-${provider}`, provider });
      expect(agent).toBeInstanceOf(ReactiveAgent);
    }
  });

  it('rejects "custom" (declarative config cannot carry a service layer)', async () => {
    await expect(
      // @ts-expect-error — custom requires a user-defined LLMService layer.
      createAgent({ name: "x", provider: "custom" }),
    ).rejects.toThrow(/invalid config/i);
  });
});
