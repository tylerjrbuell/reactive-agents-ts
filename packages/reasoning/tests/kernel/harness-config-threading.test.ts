import { describe, expect, it, afterEach } from "bun:test";
import { resolveHarnessConfig } from "../../src/harness-config.js";
import { resolveCapability } from "../../src/assembly/capability.js";

afterEach(() => {
  delete process.env.RA_RECENCY_BUDGET_CHARS;
});

describe("harness config reaches the call sites", () => {
  it("the recency budget follows the carried config over the environment", () => {
    process.env.RA_RECENCY_BUDGET_CHARS = "999";
    const r = resolveCapability({
      tier: "mid",
      window: 32_000,
      harness: resolveHarnessConfig({ recencyBudgetChars: 4096 }),
    } as Parameters<typeof resolveCapability>[0]);
    expect(r.recencyBudgetChars).toBe(4096);
  });
});
