import { describe, it, expect } from "bun:test";
import { appendExperienceTips } from "../src/engine/phases/agent-loop/reasoning-think.js";

describe("appendExperienceTips — wire the severed cross-run experience loop", () => {
  it("no-op when no tips (preserves memCtx byte-for-byte)", () => {
    expect(appendExperienceTips("base", undefined, "mid")).toBe("base");
    expect(appendExperienceTips("base", [], "mid")).toBe("base");
  });

  it("injects tips under a labeled section", () => {
    const out = appendExperienceTips("base", ["use file-write with absolute path"], "mid");
    expect(out).toContain("base");
    expect(out).toContain("Learned from prior runs");
    expect(out).toContain("- use file-write with absolute path");
  });

  it("caps to 1 tip on local (tight small-context budget)", () => {
    const out = appendExperienceTips("", ["tip-a", "tip-b", "tip-c"], "local");
    expect(out).toContain("tip-a");
    expect(out).not.toContain("tip-b");
  });

  it("caps to 3 tips on non-local tiers", () => {
    const out = appendExperienceTips("", ["a", "b", "c", "d"], "frontier");
    expect(out).toContain("- a");
    expect(out).toContain("- c");
    expect(out).not.toContain("- d");
  });

  it("undefined tier behaves as non-local (cap 3)", () => {
    const out = appendExperienceTips("", ["a", "b", "c", "d"], undefined);
    expect(out).toContain("- c");
    expect(out).not.toContain("- d");
  });
});
