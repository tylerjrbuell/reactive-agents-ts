// Run: bun test packages/core/tests/harness-pipeline.test.ts
//
// Zero test coverage existed for HarnessPipeline before this file — the
// entire `.compose(h => ...)` public API (the framework's "no black-box
// agents" escape hatch) had never been directly tested. Added alongside the
// `prompt.guidance` tag (2026-08-16): a live-QA audit found that 8 of 9
// harness-authored "Guidance:" text channels (required-tools reminders,
// oracle/ICS nudges, error-recovery, the finish-nudge, etc.) had NO
// override point at all, contradicting the framework's own design goal.
import { describe, expect, it } from "bun:test";
import { HarnessPipeline, RegistrationHarness, ALL_TAGS } from "../src/services/harness-pipeline.js";
import type { BaseCtx } from "../src/services/harness-types.js";

const baseCtx: BaseCtx = {
  iteration: 0,
  phase: "think",
  state: { taskId: "t1", iteration: 0, steps: [] } as unknown as BaseCtx["state"],
  strategy: "reactive",
};

describe("HarnessPipeline — tag catalog", () => {
  it("includes prompt.guidance", () => {
    expect(ALL_TAGS).toContain("prompt.guidance");
  });
});

describe("HarnessPipeline — transform()", () => {
  it("pass-through: returns defaultValue unchanged when no transform is registered", async () => {
    const pipeline = new HarnessPipeline([]);
    const result = await pipeline.transform("prompt.guidance", "default guidance", baseCtx);
    expect(result).toBe("default guidance");
  });

  it("pass-through: a null default (no guidance active) survives with no transforms registered", async () => {
    const pipeline = new HarnessPipeline([]);
    const result = await pipeline.transform("prompt.guidance", null, baseCtx);
    expect(result).toBeNull();
  });

  it("replaces the value when a transform returns a concrete value", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.guidance", () => "custom guidance text");
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.guidance", "default guidance", baseCtx);
    expect(result).toBe("custom guidance text");
  });

  it("suppresses the value when a transform returns null", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.guidance", () => null);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.guidance", "default guidance", baseCtx);
    expect(result).toBeNull();
  });

  it("passes the default through unchanged when a transform returns undefined", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.guidance", () => undefined);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.guidance", "default guidance", baseCtx);
    expect(result).toBe("default guidance");
  });

  it("chains multiple transforms in registration order, most-specific-last semantics", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.*", (v) => `${v ?? ""} [wildcard]`);
    h.on("prompt.guidance", (v) => `${v ?? ""} [exact]`);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.guidance", "base", baseCtx);
    // Wildcard registered first but exact-tag runs LAST (most-specific wins),
    // so its output is what the final string ends with.
    expect(result).toBe("base [wildcard] [exact]");
  });

  it("a wildcard pattern does not affect an unrelated tag", async () => {
    const h = new RegistrationHarness();
    h.on("nudge.*", () => "should not apply");
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.guidance", "untouched", baseCtx);
    expect(result).toBe("untouched");
  });

  it("gives the caller the receiving context (iteration, phase, strategy)", async () => {
    let seenCtx: BaseCtx | undefined;
    const h = new RegistrationHarness();
    h.on("prompt.guidance", (_v, ctx) => {
      seenCtx = ctx;
      return undefined;
    });
    const pipeline = new HarnessPipeline(h._collected);

    await pipeline.transform("prompt.guidance", "x", { ...baseCtx, iteration: 3, strategy: "plan-execute" });
    expect(seenCtx?.iteration).toBe(3);
    expect(seenCtx?.strategy).toBe("plan-execute");
  });
});
