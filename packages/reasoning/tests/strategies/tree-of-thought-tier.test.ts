// File: tests/strategies/tree-of-thought-tier.test.ts
// Phase 2.1: Tier-aware ToT iteration budgets + convergence check
// Phase 2.2: Strip ToT prefix from sanitized output
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { sanitizeAgentOutput } from "../../src/kernel/capabilities/verify/quality-utils.js";
import { TOT_TIER_LIMITS, getToTDepthForTier } from "../../src/strategies/tree-of-thought.js";

// ── Phase 2.1: TOT_TIER_LIMITS config ────────────────────────────────────────

describe("TOT_TIER_LIMITS", () => {
  it("exposes all four tiers", () => {
    expect(TOT_TIER_LIMITS.local).toBeDefined();
    expect(TOT_TIER_LIMITS.mid).toBeDefined();
    expect(TOT_TIER_LIMITS.large).toBeDefined();
    expect(TOT_TIER_LIMITS.frontier).toBeDefined();
  });

  it("local tier has the tightest limits", () => {
    expect(TOT_TIER_LIMITS.local.maxBfsDepth).toBeLessThanOrEqual(TOT_TIER_LIMITS.mid.maxBfsDepth);
    expect(TOT_TIER_LIMITS.local.maxPhase2Iterations).toBeLessThanOrEqual(TOT_TIER_LIMITS.mid.maxPhase2Iterations);
  });

  it("limits increase monotonically from local to frontier", () => {
    const tiers = ["local", "mid", "large", "frontier"] as const;
    for (let i = 0; i < tiers.length - 1; i++) {
      expect(TOT_TIER_LIMITS[tiers[i]].maxBfsDepth).toBeLessThanOrEqual(
        TOT_TIER_LIMITS[tiers[i + 1]].maxBfsDepth,
      );
      expect(TOT_TIER_LIMITS[tiers[i]].maxPhase2Iterations).toBeLessThanOrEqual(
        TOT_TIER_LIMITS[tiers[i + 1]].maxPhase2Iterations,
      );
    }
  });

  // Was: "stagnation window is 3 for all tiers". That test pinned the constant
  // that made the guard unreachable — one score is recorded per BFS depth and
  // effectiveDepth = min(config.depth=3, maxBfsDepth), so a window of 3 could
  // only be satisfied on the final depth, where breaking saves nothing. The
  // property that actually matters is uniformity, not the number; reachability
  // per tier is pinned in tot-cost-guard-reachable.test.ts.
  it("stagnation window is uniform across tiers and observable (>= 2)", () => {
    const tiers = ["local", "mid", "large", "frontier"] as const;
    for (const tier of tiers) {
      // A plateau needs at least two observed depths to exist.
      expect(TOT_TIER_LIMITS[tier].stagnationWindow).toBeGreaterThanOrEqual(2);
      expect(TOT_TIER_LIMITS[tier].stagnationWindow).toBe(
        TOT_TIER_LIMITS.local.stagnationWindow,
      );
    }
  });
});

describe("getToTDepthForTier", () => {
  it("returns tier-specific depth when config depth exceeds tier limit", () => {
    expect(getToTDepthForTier(10, "local")).toBe(TOT_TIER_LIMITS.local.maxBfsDepth);
  });

  it("returns config depth when below tier limit", () => {
    expect(getToTDepthForTier(2, "frontier")).toBe(2);
  });

  it("defaults to mid tier when tier is undefined", () => {
    expect(getToTDepthForTier(10, undefined)).toBe(TOT_TIER_LIMITS.mid.maxBfsDepth);
  });
});

// ── Phase 2.1: Convergence check (BFS stagnation) ───────────────────────────

describe("ToT BFS convergence check", () => {
  it("exits BFS early when best score stagnates for 3 consecutive depths", async () => {
    // All rounds score exactly 0.6 — no improvement
    // With tier=large (maxBfsDepth=4) and depth=6, effective depth is 4
    // The convergence check should exit after 3 stagnant rounds (before round 4)
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Static approach A\n2. Static approach B" },
      { match: "Rate each", text: "0.6" },
      { match: "Selected Approach", text: "FINAL ANSWER: Answer from stagnant tree." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Solve something",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 2, depth: 6, pruningThreshold: 0.3, skipBfsForTrivial: false },
          },
        },
        tier: "large",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    // Should have a stagnation message in steps
    const stagnationStep = result.steps.find((s) =>
      s.content.includes("stagnation") || s.content.includes("convergence"),
    );
    expect(stagnationStep).toBeDefined();
  });

  it("does NOT exit when scores keep improving each depth", async () => {
    // This fixture used to hand back a CONSTANT "0.7" for every scoring call
    // while its comment claimed the scores improved. Because turns are consumed
    // in order and the last turn repeats once nothing matches ahead
    // (testing.ts:104), the single scoring turn was consumed at depth 1 and every
    // later scoring call fell through to the final-answer turn, which parses to
    // no score at all — the strategy's 0.5 fallback. Best-per-depth was therefore
    // 0.50, 0.50: a plateau. The test only passed because the stagnation guard
    // was dead code; it never exercised its own name.
    //
    // Now the scores genuinely climb (0.4 → 0.7 → 0.95, deltas well outside the
    // 0.05 stagnation band), so a firing guard that still declines to exit is
    // real evidence.
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Good approach\n2. Better approach" },
      { match: "Rate each", text: "0.4" },
      { match: "Generate exactly", text: "1. Sharper approach\n2. Sharper still" },
      { match: "Rate each", text: "0.7" },
      { match: "Generate exactly", text: "1. Best approach\n2. Best still" },
      { match: "Rate each", text: "0.95" },
      { match: "Selected Approach", text: "FINAL ANSWER: Full depth answer." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Progressive improvement task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 2, depth: 3, pruningThreshold: 0.3, skipBfsForTrivial: false },
          },
        },
        tier: "frontier",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    // No stagnation exit
    const stagnationStep = result.steps.find((s) =>
      s.content.includes("stagnation") || s.content.includes("convergence"),
    );
    expect(stagnationStep).toBeUndefined();
  });
});

// ── Phase 2.1: Tier-constrained Phase 2 execution ───────────────────────────

describe("ToT tier-constrained Phase 2 iteration", () => {
  it("respects tier-specific Phase 2 iteration limit", async () => {
    const layer = TestLLMServiceLayer([
      { match: "Generate exactly", text: "1. Approach A\n2. Approach B" },
      { match: "Rate each", text: "0.8" },
      { match: "Selected Approach", text: "FINAL ANSWER: Tier constrained answer." },
    ]);

    const result = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "Simple task",
        taskType: "query",
        memoryContext: "",
        availableTools: [],
        config: {
          ...defaultReasoningConfig,
          strategies: {
            ...defaultReasoningConfig.strategies,
            treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3, skipBfsForTrivial: false },
          },
        },
        tier: "local",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.strategy).toBe("tree-of-thought");
    expect(result.status).toBe("completed");
  });
});

// ── Phase 2.2: Strip [TOT] prefix in sanitized output ───────────────────────

describe("Phase 2.2: sanitizeAgentOutput strips ToT prefixes", () => {
  it("strips [TOT] Best path prefix", () => {
    const input = "[TOT] Best path (score=0.85): Root → Approach A → Solution B";
    const result = sanitizeAgentOutput(input);
    expect(result).not.toContain("[TOT]");
    expect(result).not.toContain("Best path");
  });

  it("strips [TOT] Starting tree exploration prefix", () => {
    const input = "[TOT] Starting tree exploration: breadth=3, depth=3, pruningThreshold=0.5";
    const result = sanitizeAgentOutput(input);
    expect(result).not.toContain("[TOT]");
  });

  it("strips [TOT d=N] depth markers", () => {
    const input = "[TOT d=2] score=0.75: Some analysis approach...";
    const result = sanitizeAgentOutput(input);
    expect(result).not.toContain("[TOT d=");
  });

  it("strips [TOT] Adaptive pruning info", () => {
    const input = "[TOT] Adaptive pruning at depth 2: threshold 0.5 → 0.35, rescued 1 path(s).";
    const result = sanitizeAgentOutput(input);
    expect(result).not.toContain("[TOT]");
  });

  it("strips [TOT] Budget guard info", () => {
    const input = "[TOT] Budget guard: cost $0.0150 reached limit $0.0100. Stopping exploration.";
    const result = sanitizeAgentOutput(input);
    expect(result).not.toContain("[TOT]");
  });

  it("preserves non-ToT content after stripping", () => {
    const input = "[TOT] Best path (score=0.85): Some approach\nParis is the capital of France.";
    const result = sanitizeAgentOutput(input);
    expect(result).toContain("Paris is the capital of France.");
  });
});
