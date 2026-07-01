import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

/**
 * Docs Receipts session — the public benchmark shown at
 * docs.reactiveagents.dev/features/benchmarks.
 *
 * Trust design (2026-06-28): one current model per tier, 3 runs for variance,
 * and an internal ablation ladder (bare-llm → ra-reasoning → ra-full) so the
 * page shows "what the harness buys" rather than RA absolute numbers alone.
 *
 * DETERMINISTIC-ONLY: every task is scored by an execution / end-state / tool-
 * trace oracle — NO LLM judge (documented-unreliable for headline scoring; see
 * the research note). This makes the published numbers fully reproducible and
 * removes judge cost + judge-bias caveats. No judge-server required.
 *
 * Competitor variants are intentionally EXCLUDED (those frameworks are not
 * installed here, and a competitor sweep is a separate, costlier session).
 *
 * Generate (no judge needed):
 *   bun run --cwd packages/benchmarks bench --session docs-receipts \
 *     --output apps/docs/src/data/benchmark-report.json
 */
export const docsReceiptsSession: BenchmarkSession = {
  id: "docs-receipts",
  name: "Public Benchmark — Docs Receipts",
  version: "1.0.0",
  // DETERMINISTIC-ONLY headline set — every task has a GROUND-TRUTH oracle
  // (provided check script / tool-trace), no LLM judge, no self-graded oracle.
  // See wiki/Research/2026-06-28-agent-benchmark-scoring-practices.md.
  // NOTE: rw-7 (`bun test` on the agent's OWN tests → 0-tests-exit-0 false pass)
  // and rw-8 (agent-written generate/validate scripts) were DROPPED — their
  // oracles are self-referential, not ground truth. All local + reproducible.
  // Difficulty gradient:
  //   rw-d1 (CSV→JSON extraction) · rw-bp1 (static multi-file gen)
  //   · rw-d3 (read-only tool discipline / trace) · rw-d2 (bug-fix vs hidden cases)
  //   · rw-d4 (dollars→cents pipeline vs provided validator).
  taskIds: [
    "rw-d1", "rw-bp1", "rw-d3", "rw-d2", "rw-d4",
  ],
  // One model per capability tier (provider-diverse). Local capability is
  // resolved by the eager ollama probe in runSession (no STATIC_CAPABILITIES
  // entry required). The frontier judge (claude-opus-4-8) is pinned + distinct
  // from every SUT below, per Rule 4.
  models: [
    { id: "qwen3-14b",         provider: "ollama",    model: "qwen3:14b",         contextTier: "local" },
    { id: "gemini-2.5-flash",  provider: "gemini",    model: "gemini-2.5-flash",  contextTier: "standard" },
    { id: "gpt-4o",            provider: "openai",    model: "gpt-4o",            contextTier: "large" },
    { id: "claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6", contextTier: "frontier" },
  ],
  harnessVariants: [
    getVariant("bare-llm"),
    getVariant("ra-reasoning"),
    getVariant("ra-full"),
  ],
  runs: 3,
  traceDir: "benchmark-traces",
  concurrency: 1,
  timeoutMs: 300_000,
}
