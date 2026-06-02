/**
 * Phase-A Context-Assembly Stress A/B session.
 *
 * Pairs `ra-full` (canonical project() default-on) vs `ra-full-assembly-off`
 * (legacy `defaultContextCurator.curate()` via `RA_ASSEMBLY=0`) across local /
 * mid / frontier tiers on the failure-mode `CONTEXT_STRESS_TASKS`. Whole-vs-
 * whole, N≥3 → pass^k via `SessionReproducibility`. Used to gate the legacy
 * curate() deletion in the redesign arc; the equal-or-better invariant is
 * enforced through the package's existing judge + `AblationResult`.
 */
import type { BenchmarkSession } from "../types.js";
import { getVariant } from "../session.js";

export const contextStressSession: BenchmarkSession = {
  id: "context-stress",
  name: "Context-Assembly Stress A/B (project vs legacy)",
  version: "1.0.0",
  taskIds: [
    "cs-overflow-transcribe",
    "cs-overflow-summarize",
    "cs-recall-temptation",
    "cs-dishonest-bait",
  ],
  models: [
    { id: "qwen3.5-local", provider: "ollama", model: "qwen3.5:latest", contextTier: "local" },
    { id: "claude-haiku", provider: "anthropic", model: "claude-haiku-4-5", contextTier: "standard" },
    { id: "claude-sonnet", provider: "anthropic", model: "claude-sonnet-4-6", contextTier: "frontier" },
  ],
  harnessVariants: [getVariant("ra-full"), getVariant("ra-full-assembly-off")],
  runs: 3, // pass^k, N≥3 (canonical-harness-core P4)
  timeoutMs: 180_000,
};
