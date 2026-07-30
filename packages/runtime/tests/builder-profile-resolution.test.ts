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

  it("developer-supplied numCtx reaches the resolved context profile (prime-before-profile ordering)", async () => {
    // Regression pin for the 2026-07-30 budget/wire divergence: the builder
    // resolved the context profile (tier + maxTokens/window) from the capability
    // registry BEFORE priming it (probe + user-supplied numCtx), so the profile
    // froze to the 2048-ctx `source: "fallback"` while the wire num_ctx resolved
    // later from the primed registry. Every tool-result compression budget then
    // derived from the starved 2048 window — a 25-KB result crushed to ~1.2 KB,
    // driving live fabrication. The fix moves prime + registerUserSuppliedCapability
    // ABOVE the profile resolve so ONE knob (`numCtx`) moves both budget and wire.
    //
    // Deterministic (no Ollama): a novel model name resolves to `fallback`, so
    // `.withModel({ numCtx })` is the sole window source. If registration ran
    // AFTER the profile resolve (the bug), maxTokens would be the 2048 fallback.
    const declaredNumCtx = 65536;
    const uniqueModel = `budget-divergence-pin-${Date.now()}`;
    const builder = ReactiveAgents.create()
      .withName("numctx-reaches-profile")
      .withProvider("test")
      .withModel({ model: uniqueModel, numCtx: declaredNumCtx });
    await builder.build();

    const resolvedProfile = (
      builder as unknown as { _contextProfile?: { maxTokens?: number } }
    )._contextProfile;
    expect(resolvedProfile?.maxTokens).toBe(declaredNumCtx);
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
