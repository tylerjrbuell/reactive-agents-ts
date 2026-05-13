import { describe, it, expect } from "bun:test";
import { HarnessPipeline, RegistrationHarness } from "../src/services/harness-pipeline.js";
import type { BaseCtx, KernelStateLike } from "../src/index.js";

// ─── Test helpers ──────────────────────────────────────────────────────────────

const MOCK_STATE: KernelStateLike = {
  taskId: "t-test",
  strategy: "react",
  kernelType: "fc",
  steps: [],
  toolsUsed: new Set(),
  iteration: 1,
  tokens: 0,
  status: "thinking",
  output: null,
  error: null,
  meta: {},
};

const BASE_CTX: BaseCtx = {
  iteration: 1,
  phase: "think",
  state: MOCK_STATE,
  strategy: "react",
};

// ─── HarnessPipeline.transform ────────────────────────────────────────────────

describe("HarnessPipeline — on() transform", () => {
  it("exact pattern: transforms value when tag matches exactly", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.system", (prompt) => `[prefix] ${prompt}`);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "hello", BASE_CTX);

    expect(result).toBe("[prefix] hello");
  });

  it("wildcard '.*': transforms value for single-segment matching tags", async () => {
    const h = new RegistrationHarness();
    h.on("nudge.*", (payload) => `[nudge] ${payload}`);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("nudge.loop-detected", "looping", {
      ...BASE_CTX,
      trigger: "loop",
      severity: "warn",
    });

    expect(result).toBe("[nudge] looping");
  });

  it("wildcard '.**': transforms value for multi-segment matching tags", async () => {
    const h = new RegistrationHarness();
    h.on("nudge.**", (payload) => `[catch-all] ${payload}`);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("nudge.healing-failure", "heal failed", {
      ...BASE_CTX,
      trigger: "heal",
      severity: "critical",
    });

    expect(result).toBe("[catch-all] heal failed");
  });

  it("catch-all '**': transforms any tag", async () => {
    const h = new RegistrationHarness();
    h.on("**", (payload) => (typeof payload === "string" ? `[all] ${payload}` : payload));
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "system prompt", BASE_CTX);

    expect(result).toBe("[all] system prompt");
  });

  it("predicate function: transforms when predicate returns true", async () => {
    const h = new RegistrationHarness();
    h.on((tag) => tag.startsWith("prompt"), (payload) => (typeof payload === "string" ? `[pred] ${payload}` : payload));
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "hello", BASE_CTX);

    expect(result).toBe("[pred] hello");
  });
});

// ─── HarnessPipeline.tap ─────────────────────────────────────────────────────

describe("HarnessPipeline — tap() observes without changing value", () => {
  it("tap does not change the returned value", async () => {
    const observed: string[] = [];
    const h = new RegistrationHarness();
    h.tap("prompt.system", (prompt) => {
      observed.push(prompt);
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "original", BASE_CTX);

    expect(result).toBe("original");
    expect(observed).toEqual(["original"]);
  });

  it("tap runs even when no transforms are registered (pass-through path)", async () => {
    const observed: string[] = [];
    const h = new RegistrationHarness();
    h.tap("prompt.system", (prompt) => {
      observed.push(prompt);
    });
    const pipeline = new HarnessPipeline(h._collected);

    // No transforms, just a tap — should return defaultValue unchanged.
    const result = await pipeline.transform("prompt.system", "default value", BASE_CTX);

    expect(result).toBe("default value");
    expect(observed).toEqual(["default value"]);
  });

  it("tap runs after the full transform chain, sees final value", async () => {
    const observed: string[] = [];
    const h = new RegistrationHarness();
    h.on("prompt.system", (prompt) => `${prompt}[transformed]`);
    h.tap("prompt.system", (prompt) => {
      observed.push(prompt);
    });
    const pipeline = new HarnessPipeline(h._collected);

    await pipeline.transform("prompt.system", "hello", BASE_CTX);

    expect(observed).toEqual(["hello[transformed]"]);
  });

  it("tap is NOT called when value is suppressed (null)", async () => {
    const observed: string[] = [];
    const h = new RegistrationHarness();
    h.on("prompt.system", () => null); // suppress
    h.tap("prompt.system", (prompt) => {
      observed.push(prompt);
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "hello", BASE_CTX);

    expect(result).toBeNull();
    expect(observed).toHaveLength(0);
  });
});

// ─── Specificity ordering ─────────────────────────────────────────────────────

describe("HarnessPipeline — most-specific pattern wins", () => {
  it("exact tag overrides wildcard when both match", async () => {
    const h = new RegistrationHarness();
    // Register broadest first (registration order should NOT matter — specificity wins)
    h.on("**", () => "from wildcard");
    h.on("prompt.system", () => "from exact");
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "original", BASE_CTX);

    // Exact runs last → has final say
    expect(result).toBe("from exact");
  });

  it("'.*' single-segment overrides '**' catch-all", async () => {
    const h = new RegistrationHarness();
    h.on("**", () => "catch-all");
    h.on("prompt.*", () => "single-wildcard");
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "original", BASE_CTX);

    expect(result).toBe("single-wildcard");
  });

  it("exact overrides '.*' single-segment wildcard", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.*", () => "single-wildcard");
    h.on("prompt.system", () => "exact");
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "original", BASE_CTX);

    expect(result).toBe("exact");
  });

  it("same-specificity transforms run in registration order", async () => {
    // Two exact transforms for the same tag — registration order wins within tier
    const calls: string[] = [];
    const h = new RegistrationHarness();
    h.on("prompt.system", (prompt) => {
      calls.push("first");
      return `${prompt}+first`;
    });
    h.on("prompt.system", (prompt) => {
      calls.push("second");
      return `${prompt}+second`;
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "base", BASE_CTX);

    // First runs, then second (same specificity — registration order), final result is second's
    expect(calls).toEqual(["first", "second"]);
    expect(result).toBe("base+first+second");
  });
});

// ─── Pass-through semantics ───────────────────────────────────────────────────

describe("HarnessPipeline — pass-through when no transform registered", () => {
  it("returns defaultValue unchanged when no transforms match the tag", async () => {
    const h = new RegistrationHarness();
    // Only register for a different tag
    h.on("nudge.loop-detected", (p) => `changed: ${p}`);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "untouched", BASE_CTX);

    expect(result).toBe("untouched");
  });

  it("empty pipeline returns defaultValue unchanged", async () => {
    const pipeline = new HarnessPipeline([]);

    const result = await pipeline.transform("prompt.system", "unchanged", BASE_CTX);

    expect(result).toBe("unchanged");
  });

  it("pattern that matches wrong tag does NOT affect unmatched tag", async () => {
    const h = new RegistrationHarness();
    h.on("nudge.*", () => "wrong");
    const pipeline = new HarnessPipeline(h._collected);

    // 'prompt.system' does not match 'nudge.*'
    const result = await pipeline.transform("prompt.system", "correct", BASE_CTX);

    expect(result).toBe("correct");
  });
});

// ─── undefined / null transform semantics ────────────────────────────────────

describe("HarnessPipeline — undefined keeps current; null suppresses", () => {
  it("undefined from transform keeps the current value", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.system", () => undefined); // keep current
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "keep me", BASE_CTX);

    expect(result).toBe("keep me");
  });

  it("null from transform suppresses the value (returns null)", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.system", () => null);
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "suppress me", BASE_CTX);

    expect(result).toBeNull();
  });

  it("undefined after null keeps suppression", async () => {
    const h = new RegistrationHarness();
    // '**' runs first (broadest), exact runs second (most-specific)
    h.on("**", () => null);          // suppress
    h.on("prompt.system", () => undefined); // keep suppressed
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "original", BASE_CTX);

    // Suppressed by '**', then undefined from exact keeps suppression
    expect(result).toBeNull();
  });

  it("concrete value after null re-introduces the value", async () => {
    const h = new RegistrationHarness();
    // '**' suppresses first, exact re-introduces with a concrete value
    h.on("**", () => null);
    h.on("prompt.system", () => "re-introduced");
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "original", BASE_CTX);

    expect(result).toBe("re-introduced");
  });

  it("async transform resolves correctly", async () => {
    const h = new RegistrationHarness();
    h.on("prompt.system", async (prompt) => {
      return `async: ${prompt}`;
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "hello", BASE_CTX);

    expect(result).toBe("async: hello");
  });
});

// ─── Multiple .withHarness() chains additively (withRegistrations) ────────────

describe("HarnessPipeline — multiple withHarness() chains additively", () => {
  it("withRegistrations() adds new entries to a new pipeline (both apply)", async () => {
    const h1 = new RegistrationHarness();
    h1.on("prompt.system", (p) => `${p}[h1]`);

    const h2 = new RegistrationHarness();
    h2.on("prompt.system", (p) => `${p}[h2]`);

    const pipeline1 = new HarnessPipeline(h1._collected);
    const pipeline2 = pipeline1.withRegistrations(h2._collected);

    const result = await pipeline2.transform("prompt.system", "base", BASE_CTX);

    // Both transforms run in registration order (same specificity — exact)
    expect(result).toBe("base[h1][h2]");
  });

  it("withRegistrations() returns a NEW pipeline; original is unchanged", async () => {
    const h1 = new RegistrationHarness();
    h1.on("prompt.system", (p) => `${p}[h1]`);

    const h2 = new RegistrationHarness();
    h2.on("prompt.system", (p) => `${p}[h2]`);

    const pipeline1 = new HarnessPipeline(h1._collected);
    const pipeline2 = pipeline1.withRegistrations(h2._collected);

    const result1 = await pipeline1.transform("prompt.system", "base", BASE_CTX);
    const result2 = await pipeline2.transform("prompt.system", "base", BASE_CTX);

    expect(result1).toBe("base[h1]");
    expect(result2).toBe("base[h1][h2]");
  });

  it("three chained calls accumulate all registrations", async () => {
    const calls: number[] = [];

    const h1 = new RegistrationHarness();
    h1.tap("prompt.system", () => { calls.push(1); });

    const h2 = new RegistrationHarness();
    h2.tap("prompt.system", () => { calls.push(2); });

    const h3 = new RegistrationHarness();
    h3.tap("prompt.system", () => { calls.push(3); });

    const pipeline = new HarnessPipeline(h1._collected)
      .withRegistrations(h2._collected)
      .withRegistrations(h3._collected);

    await pipeline.transform("prompt.system", "hello", BASE_CTX);

    expect(calls).toEqual([1, 2, 3]);
  });
});

// ─── RegistrationHarness.use() ────────────────────────────────────────────────

describe("RegistrationHarness — use() composes sub-harness registrations", () => {
  it("use() flattens sub-harness registrations into parent pipeline", async () => {
    const h = new RegistrationHarness();
    h.use((sub) => {
      sub.on("prompt.system", (p) => `${p}[sub]`);
    });
    const pipeline = new HarnessPipeline(h._collected);

    const result = await pipeline.transform("prompt.system", "base", BASE_CTX);

    expect(result).toBe("base[sub]");
  });
});

// ─── registeredTags ───────────────────────────────────────────────────────────

describe("HarnessPipeline — registeredTags()", () => {
  it("returns concrete tags that a wildcard pattern covers", () => {
    const h = new RegistrationHarness();
    h.on("nudge.*", (p) => p);
    const pipeline = new HarnessPipeline(h._collected);

    const tags = pipeline.registeredTags();

    expect(tags).toContain("nudge.loop-detected");
    expect(tags).toContain("nudge.healing-failure");
    expect(tags).not.toContain("prompt.system");
  });

  it("empty pipeline returns empty tags", () => {
    const pipeline = new HarnessPipeline([]);
    expect(pipeline.registeredTags()).toHaveLength(0);
  });
});
