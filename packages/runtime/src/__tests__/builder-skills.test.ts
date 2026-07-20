import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../builder.js";

describe(".withSkills() builder", () => {
  it("accepts non-empty paths", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withSkills({ paths: ["./custom-skills/"] });
    expect(builder).toBeDefined();
  });

  // P0-10 (v0.14): a path-less call registered NOTHING (runtime construction
  // gated on paths.length) — the silent no-op was the lie, so it now throws.
  it("throws on a path-less call (was a silent no-op)", () => {
    expect(() =>
      (ReactiveAgents.create().withProvider("test") as any).withSkills(),
    ).toThrow(/paths/);
  });

  it("throws on empty paths (would register nothing)", () => {
    expect(() =>
      ReactiveAgents.create().withProvider("test").withSkills({ paths: [] }),
    ).toThrow(/paths/);
  });

  // P0-10 (v0.14): `packages` / `evolution` / `overrides` were accepted but
  // never read anywhere downstream. Removed keys are rejected loudly.
  it("throws on removed `packages` key", () => {
    expect(() =>
      (ReactiveAgents.create().withProvider("test") as any).withSkills({
        paths: ["./s/"],
        packages: ["@acme/skills"],
      }),
    ).toThrow(/removed in v0\.14/);
  });

  it("throws on removed `evolution` key", () => {
    expect(() =>
      (ReactiveAgents.create().withProvider("test") as any).withSkills({
        paths: ["./s/"],
        evolution: { mode: "suggest", refinementThreshold: 10 },
      }),
    ).toThrow(/removed in v0\.14/);
  });

  it("throws on removed `overrides` key", () => {
    expect(() =>
      (ReactiveAgents.create().withProvider("test") as any).withSkills({
        paths: ["./s/"],
        overrides: { "my-skill": { evolutionMode: "locked" } },
      }),
    ).toThrow(/removed in v0\.14/);
  });

  it("chains with other builder methods", () => {
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withSkills({ paths: ["./skills/"] })
      .withReasoning()
      .withReactiveIntelligence();
    expect(builder).toBeDefined();
  });
});

describe("Extended .withReactiveIntelligence() hooks", () => {
  it("accepts onEntropyScored callback", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ onEntropyScored: () => {} });
    expect(builder).toBeDefined();
  });

  // P0-1 (v0.14, SAFETY): `constraints` / `autonomy` were write-only — a user
  // asking for observe-only got a fully autonomous controller. The options
  // were removed from the type AND throw at runtime for structural stragglers.
  it("throws on removed constraints object (was a no-op safety switch)", () => {
    expect(() =>
      (ReactiveAgents.create().withProvider("test") as any)
        .withReactiveIntelligence({
          constraints: { maxTemperatureAdjustment: 0.1, neverEarlyStop: true },
        }),
    ).toThrow(/removed in v0\.14/);
  });

  it("throws on removed autonomy level (was a no-op safety switch)", () => {
    expect(() =>
      (ReactiveAgents.create().withProvider("test") as any)
        .withReactiveIntelligence({ autonomy: "observe" }),
    ).toThrow(/removed in v0\.14/);
  });

  it("still accepts boolean form", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence(false);
    expect(builder).toBeDefined();
  });

  it("still accepts plain RI config", () => {
    const builder = ReactiveAgents.create().withProvider("test")
      .withReactiveIntelligence({ controller: { earlyStop: true, contextCompression: false, strategySwitch: false } });
    expect(builder).toBeDefined();
  });
});
