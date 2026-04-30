import type { BenchmarkSession } from "../types.js"
import { ABLATION_VARIANTS, getVariant } from "../session.js"

/**
 * Frontier spot-check session — validates the harness on frontier-tier models
 * before tagging a release. Stage 6 W21 added this after a regression-gate
 * sweep on `claude-haiku-4-5` returned 41% accuracy and the Stage-5 overhaul
 * had concentrated optimization effort on local-tier models.
 *
 * Default shape: 4 frontier models × `bare-llm` + `ra-full` so we get both
 * absolute scores AND harness lift. 5 representative tasks across moderate /
 * complex / expert tiers (not the full 17 — frontier API spend adds up fast).
 *
 * Approximate cost (one full run): $3–8 across all four providers depending
 * on token budgets. Override with `--task` to slice further.
 */
export const frontierSpotCheckSession: BenchmarkSession = {
  id: "frontier-spot-check",
  name: "Frontier Spot Check",
  version: "1.0.0",
  taskIds: [
    // 1 trivial (capability check) + 2 moderate + 1 complex + 1 expert
    "t1-js-typeof",
    "m1-merge-intervals",
    "m4-remove-duplicates",
    "c5-multi-tool",
    "e3-logic-fallacy",
  ],
  models: [
    { id: "claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6",  contextTier: "standard" },
    { id: "claude-haiku-4-5",  provider: "anthropic", model: "claude-haiku-4-5",   contextTier: "standard" },
    { id: "gpt-4o-mini",       provider: "openai",    model: "gpt-4o-mini",         contextTier: "standard" },
    { id: "gemini-2.5-pro",    provider: "gemini",    model: "gemini-2.5-pro",      contextTier: "standard" },
  ],
  harnessVariants: [
    getVariant("bare-llm"),
    getVariant("ra-full"),
  ],
  runs: 1,
  concurrency: 1,
  timeoutMs: 180_000,
}
