import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

/**
 * Cluster-A gate (2026-06-29) — validates the Gemini thinking-budget starvation
 * fix (llm-provider/src/providers/gemini.ts) with a before/after accuracy A/B.
 *
 * The bug bites the HARNESS path: think.ts:584 caps visible output by tier
 * (mid=2000, frontier=4000) and Gemini 2.5 thinks-by-default with a dynamic
 * budget that eats the whole cap → truncated answer. So the gate runs `ra-full`
 * (where the cap applies) on reasoning-heavy, deterministically-scored tasks
 * (regex `expected`, no LLM judge) where truncation = wrong answer.
 *
 * Models: Gemini both tiers (the patient) + claude-haiku-4-5 (control: thinking
 * off by default, must NOT regress). Run this on the fixed code → after.json,
 * then restore the pre-fix gemini.ts and re-run → before.json, and compare the
 * per-cell accuracy on the Gemini cells.
 */
export const clusterAGateSession: BenchmarkSession = {
  id: "cluster-a-gate",
  name: "Cluster A — Gemini thinking-budget gate",
  version: "1.0.0",
  taskIds: [
    "m2-word-problem",     // moderate — multi-step arithmetic reasoning
    "m3-sql-injection",    // moderate — vuln identification + fix
    "e1-lis-optimization", // expert — tree-of-thought (complete() path; G2 timeout regression test)
  ],
  models: [
    { id: "gemini-2.5-flash", provider: "gemini",    model: "gemini-2.5-flash", contextTier: "standard" },
    { id: "gemini-2.5-pro",   provider: "gemini",    model: "gemini-2.5-pro",   contextTier: "standard" },
    { id: "claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
  ],
  harnessVariants: [getVariant("ra-full")],
  runs: 2,
  concurrency: 1,
  timeoutMs: 240_000,
}
