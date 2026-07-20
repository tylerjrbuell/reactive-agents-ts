/**
 * Phase-A Context-Assembly Stress session (single-arm pin).
 *
 * Runs the canonical `ra-full` (project() default-on) arm across local / mid /
 * frontier tiers on the failure-mode `CONTEXT_STRESS_TASKS`, N≥3 → pass^k via
 * `SessionReproducibility`. Originally an A/B vs a legacy `curate()` arm; that
 * arm and its env gate were deleted in Sprint-1 A2 (2026-06-02) once project()
 * became the sole assembler, so this now pins project()'s cross-tier behaviour
 * on the stress tasks rather than comparing two arms.
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
  harnessVariants: [getVariant("ra-full")],
  runs: 3, // pass^k, N≥3 (canonical-harness-core P4)
  timeoutMs: 180_000,
};
