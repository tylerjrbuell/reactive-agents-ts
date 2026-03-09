import { describe, it, expect } from "bun:test";
import { ReactiveAgents, ReactiveAgent } from "../src/index.js";
import { resolveProfile } from "@reactive-agents/reasoning";

describe("Builder auto-resolves context profile from model name", () => {
  it("auto-resolves mid profile for capable local model", async () => {
    // resolveProfile should map "cogito:14b" to mid tier (capable local model)
    const profile = resolveProfile("cogito:14b");
    expect(profile.tier).toBe("mid");

    // Builder should auto-resolve and produce a valid agent
    const agent = await ReactiveAgents.create()
      .withName("local-test")
      .withProvider("test")
      .withModel("cogito:14b")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("auto-resolves frontier profile for opus model", async () => {
    // resolveProfile should map "claude-opus-4-20250514" to frontier tier
    const profile = resolveProfile("claude-opus-4-20250514");
    expect(profile.tier).toBe("frontier");

    // Builder should auto-resolve and produce a valid agent
    const agent = await ReactiveAgents.create()
      .withName("frontier-test")
      .withProvider("test")
      .withModel("claude-opus-4-20250514")
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);
  });

  it("explicit withContextProfile overrides auto-resolution", async () => {
    // Even though model name would resolve to "mid", explicit profile wins
    const agent = await ReactiveAgents.create()
      .withName("override-test")
      .withProvider("test")
      .withModel("cogito:14b")
      .withContextProfile({ tier: "frontier" })
      .build();

    expect(agent).toBeInstanceOf(ReactiveAgent);

    // Verify resolveProfile gives "mid" for this capable local model
    const autoResolved = resolveProfile("cogito:14b");
    expect(autoResolved.tier).toBe("mid");
  });
});
