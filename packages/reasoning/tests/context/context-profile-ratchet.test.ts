// Run: bun test packages/reasoning/tests/context/context-profile-ratchet.test.ts --timeout 15000
//
// Wave 2a Area 3 (2026-10-13) — monotone tier-budget ladder ratchet.
//
// Pins CONTEXT_PROFILES as a coherent ladder so a D-2026-07-30-H-class
// inversion can never recur silently. The dispatch asked for "monotone
// non-decreasing across local<=mid<=frontier (whole table)"; taken literally
// that is unsatisfiable for the preservation budgets, whose *designed* shape
// tightens as capability rises (mid 1200 ≥ large 800 ≥ frontier 600 — bigger
// windows can afford to drop old tool results harder). What actually caused
// the D-2026-07-30-H smell was the local tier *breaking* the ladder direction
// (4000 > 1200). The ratchet therefore encodes, for the whole table:
//
//   1. SPEND budgets (maxTokens, maxIterations, temperature) — non-decreasing
//      up the capability ladder: more capable tiers get strictly larger
//      allowances.
//   2. PRESERVE budgets (toolResultMaxChars, toolResultPreviewItems) —
//      non-increasing up the ladder: preservation tightens as windows grow.
//   3. D-2026-07-30-H guard — no field may have local > mid in the preserve
//      direction… precisely: local.toolResultMaxChars ≤ mid.toolResultMaxChars
//      AND local.toolResultPreviewItems ≤ mid.toolResultPreviewItems is NOT
//      asserted (preview 8 is the sanctioned local filter-task exception — see
//      the 2026-05-28 bump comment in context-profile.ts). What IS asserted
//      for the char budget: local ≤ mid (the dispatched fix, "choose
//      local<=mid"), which in combination with rule 2 pins local == mid.
//
// Rule 3 is the regression pin: before the Wave 2a fix it failed loudly
// (4000 > 1200); any future one-sided bump trips it again.

import { describe, it, expect } from "bun:test";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import { TIER_TOOL_RESULT_PRESERVE } from "@reactive-agents/core";

const TIERS = ["local", "mid", "large", "frontier"] as const;
type Tier = (typeof TIERS)[number];

function ladder(field: "maxTokens" | "maxIterations" | "temperature"): number[] {
  return TIERS.map((t: Tier) => CONTEXT_PROFILES[t][field]);
}

function preserveLadder(field: "toolResultMaxChars" | "toolResultPreviewItems"): number[] {
  return TIERS.map((t: Tier) => CONTEXT_PROFILES[t][field]);
}

describe("CONTEXT_PROFILES tier-budget ratchet (D-2026-07-30-H)", () => {
  it("spend budgets are monotone non-decreasing local → mid → large → frontier", () => {
    for (const field of ["maxTokens", "maxIterations", "temperature"] as const) {
      const values = ladder(field);
      for (let i = 1; i < values.length; i++) {
        expect(
          values[i]! >= values[i - 1]!,
          `${field}: ${TIERS[i]} (${values[i]}) must be >= ${TIERS[i - 1]} (${values[i - 1]})`,
        ).toBe(true);
      }
    }
  }, 15_000);

  it("preserve budgets are monotone non-increasing local → mid → large → frontier", () => {
    for (const field of ["toolResultMaxChars", "toolResultPreviewItems"] as const) {
      const values = preserveLadder(field);
      for (let i = 1; i < values.length; i++) {
        expect(
          values[i]! <= values[i - 1]!,
          `${field}: ${TIERS[i]} (${values[i]}) must be <= ${TIERS[i - 1]} (${values[i - 1]})`,
        ).toBe(true);
      }
    }
  }, 15_000);

  it("D-2026-07-30-H guard: local.toolResultMaxChars <= mid.toolResultMaxChars", () => {
    // The inversion the debt recorded: a capable model (mid) preserving LESS
    // of an old tool result than a tiny model (local). Fixed in Wave 2a by
    // choosing local ≤ mid; this guard forbids the regression in either
    // field's direction without re-measurement.
    expect(CONTEXT_PROFILES.local.toolResultMaxChars).toBeLessThanOrEqual(
      CONTEXT_PROFILES.mid.toolResultMaxChars,
    );
  }, 15_000);

  it("core mirror TIER_TOOL_RESULT_PRESERVE stays in lockstep with CONTEXT_PROFILES", () => {
    // @reactive-agents/core keeps a hand-copied mirror of the preserve ladder
    // for callers that can't import reasoning. The D-2026-07-30-H fix had to
    // move BOTH copies; this pin makes a half-fix fail loudly.
    for (const tier of TIERS) {
      expect(
        TIER_TOOL_RESULT_PRESERVE[tier],
        `TIER_TOOL_RESULT_PRESERVE.${tier} must equal CONTEXT_PROFILES.${tier}.toolResultMaxChars`,
      ).toBe(CONTEXT_PROFILES[tier].toolResultMaxChars);
    }
  }, 15_000);

  it("every tier in the whole table defines all numeric budget fields", () => {
    // Ratchet hygiene: a tier silently dropping a field would make the
    // monotone checks vacuously pass on undefined comparisons.
    for (const tier of TIERS) {
      const profile = CONTEXT_PROFILES[tier];
      for (const field of [
        "maxTokens",
        "maxIterations",
        "temperature",
        "toolResultMaxChars",
        "toolResultPreviewItems",
      ] as const) {
        expect(typeof profile[field], `${tier}.${field}`).toBe("number");
      }
    }
  }, 15_000);
});
