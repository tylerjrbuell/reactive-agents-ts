import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

/**
 * Cross-tier stress map (2026-06-29) — maps where each provider × tier breaks on
 * CHALLENGING reasoning, to surface the biggest CROSS-CUTTING framework issues
 * (not niche single-strategy bugs). Deterministically scored (regex `expected`,
 * no LLM judge). ra-full only — we're mapping the real harness path, not lift.
 *
 * Task spread spans all three multi-step strategies so the map isn't biased to
 * one code path:
 *   - react:        m2 (moderate), c4 (complex), e6 (expert)
 *   - plan-execute: c2 (complex)
 *   - tree-of-thought: e3 (expert)
 *
 * Model spread spans all 4 providers and 4 tiers:
 *   - local:    qwen3:14b, cogito:14b
 *   - openai:   gpt-4o-mini (mid)
 *   - anthropic: claude-haiku-4-5 (mid), claude-sonnet-4-6 (large)
 *   - gemini:   gemini-2.5-flash (mid), gemini-2.5-pro (frontier)
 */
export const crossTierStressSession: BenchmarkSession = {
  id: "cross-tier-stress",
  name: "Cross-tier stress map",
  version: "1.0.0",
  taskIds: [
    "m2-word-problem",        // react · moderate
    "c4-db-decomposition",    // react · complex
    "e6-guardrail-injection", // react · expert
    "c2-auth-vulnerabilities",// plan-execute · complex
    "e3-logic-fallacy",       // tree-of-thought · expert
  ],
  models: [
    { id: "qwen3:14b",        provider: "ollama",    model: "qwen3:14b",        contextTier: "standard" },
    { id: "cogito:14b",       provider: "ollama",    model: "cogito:14b",       contextTier: "standard" },
    { id: "gpt-4o-mini",      provider: "openai",    model: "gpt-4o-mini",      contextTier: "standard" },
    { id: "claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
    { id: "claude-sonnet-4-6",provider: "anthropic", model: "claude-sonnet-4-6",contextTier: "standard" },
    { id: "gemini-2.5-flash", provider: "gemini",    model: "gemini-2.5-flash", contextTier: "standard" },
    { id: "gemini-2.5-pro",   provider: "gemini",    model: "gemini-2.5-pro",   contextTier: "standard" },
  ],
  harnessVariants: [getVariant("ra-full")],
  runs: 1,
  concurrency: 1,
  timeoutMs: 300_000,
}
