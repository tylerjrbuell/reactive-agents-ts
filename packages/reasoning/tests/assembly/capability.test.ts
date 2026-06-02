import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("resolveCapability — single source; budgets derived", () => {
  it("derives recency/aged budgets from the window", () => {
    const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(cap.recencyBudgetChars).toBe(Math.floor(15360 * 0.35 * 4));
    expect(cap.agedBudgetChars).toBeLessThan(cap.recencyBudgetChars);
  });
  it("RA_RECENCY_BUDGET_CHARS overrides the derived recency budget (test knob)", () => {
    process.env.RA_RECENCY_BUDGET_CHARS = "2000";
    try {
      const cap = resolveCapability({ window: 32768, outputBudget: 2000, dialect: "native-fc", tier: "mid" });
      expect(cap.recencyBudgetChars).toBe(2000);
    } finally {
      delete process.env.RA_RECENCY_BUDGET_CHARS;
    }
  });
  it("predicts num_ctx as smallest bucket ≥ assembled+output+headroom", () => {
    const cap = resolveCapability({ window: 131072, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(cap.predictNumCtx(6000)).toBe(16384); // 6000 + 2000 + 1024 → 16k bucket
    expect(cap.predictNumCtx(20000)).toBe(32768);
  });

  it("toolResultPreserveBudget is tier-aware (mirrors legacy CONTEXT_PROFILES.toolResultMaxChars)", () => {
    // Phase-A 2026-06-02: separating per-result preservation from total
    // recency-window. Tier-aware defaults match the empirically-tuned
    // legacy table — local 4000 / mid 1200 / large 800 / frontier 600 —
    // so canonical project() compresses raw tool results at the same
    // threshold legacy curate() did, closing the 27% token-bloat gap.
    const local = resolveCapability({ window: 32768, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    const mid = resolveCapability({ window: 32768, outputBudget: 2000, dialect: "native-fc", tier: "mid" });
    const large = resolveCapability({ window: 200000, outputBudget: 2000, dialect: "native-fc", tier: "large" });
    const frontier = resolveCapability({ window: 200000, outputBudget: 2000, dialect: "native-fc", tier: "frontier" });
    expect(local.toolResultPreserveBudget).toBe(4000);
    expect(mid.toolResultPreserveBudget).toBe(1200);
    expect(large.toolResultPreserveBudget).toBe(800);
    expect(frontier.toolResultPreserveBudget).toBe(600);
  });

  it("RA_TOOL_RESULT_BUDGET_CHARS overrides the tier default (ablation knob)", () => {
    process.env.RA_TOOL_RESULT_BUDGET_CHARS = "777";
    try {
      const cap = resolveCapability({ window: 32768, outputBudget: 2000, dialect: "native-fc", tier: "mid" });
      expect(cap.toolResultPreserveBudget).toBe(777);
    } finally {
      delete process.env.RA_TOOL_RESULT_BUDGET_CHARS;
    }
  });

  it("toolResultPreserveBudget is independent of window size (decoupled from recency)", () => {
    // The previous design conflated "fits in window" with "fits in attention"
    // (project-results used recencyBudgetChars = window*0.35*4). Verify the
    // two budgets are now decoupled — preserve stays at tier default
    // regardless of window scale.
    const tinyWindow = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" });
    const hugeWindow = resolveCapability({ window: 200000, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(tinyWindow.toolResultPreserveBudget).toBe(4000);
    expect(hugeWindow.toolResultPreserveBudget).toBe(4000);
    // recency still scales with window
    expect(tinyWindow.recencyBudgetChars).toBeLessThan(hugeWindow.recencyBudgetChars);
  });
});
