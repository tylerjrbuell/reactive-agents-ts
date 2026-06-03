// File: src/sessions/recitation-ablation.ts
//
// WS-4 progress-recitation ablation — the cross-tier pass^k gate that decides
// whether RA_RECITE flips default-on (project lift rule: ≥3pp first-attempt
// lift AND ≤15% token overhead).
//
// Two otherwise-identical variants on condition-bearing tasks (file-write
// deliverables → deriveConditions emits ArtifactProduced + ToolCalled, so the
// recitation actually fires):
//
//   • ra-full    — recitation OFF (RA_RECITE unset)
//   • ra-recite  — recitation ON  (RA_RECITE=1)
//
// Tasks rw-3 (report.md) / rw-9 (prices.md) are the drift-to-prose failure
// class the PostCondition spine targets: a model under a long transcript can
// "summarize" without ever writing the file. Recitation keeps "write the file
// ./report.md" in attention every turn — this measures whether that helps.
//
// Cross-tier (local Ollama + mid via .env keys), N=3 → pass^k via
// SessionReproducibility. Graded by the live judge (Rule 4: judge ≠ SUT) —
// requires JUDGE_URL or --judge-url. The runner's preflight probes /version and
// fails fast on a judge/SUT collision; per-cell capability-source preflight
// marks fallback-source cells inconclusive.
//
// Fan-out: 2 tiers × 2 variants × 2 tasks × 3 runs = 24 dispatches.

import type { BenchmarkSession, HarnessVariant } from "../types.js"
import { getVariant } from "../session.js"

// Recite arm = ra-full config + RA_RECITE=1 (the ONLY difference is the
// env-gated goal_state emission in fromKernelState). Defined inline — not added
// to the global ABLATION_VARIANTS ladder, which would bloat every full sweep.
const raReciteVariant: HarnessVariant = {
  type: "internal",
  id: "ra-recite",
  label: "RA Full (+Recitation)",
  config: {
    tools: true, reasoning: true, reactiveIntelligence: true, memory: true,
    env: { RA_RECITE: "1" },
  },
}

export const recitationAblationSession: BenchmarkSession = {
  id: "recitation-ablation",
  name: "WS-4 Progress-Recitation Ablation (cross-tier pass^k gate)",
  version: "1.0.0",
  taskIds: ["rw-3", "rw-9"],
  models: [
    { id: "qwen3.5-local", provider: "ollama",    model: "qwen3.5:latest", contextTier: "local"    },
    { id: "gpt-4o-mini",   provider: "openai",     model: "gpt-4o-mini",    contextTier: "standard" },
  ],
  harnessVariants: [
    getVariant("ra-full"),
    raReciteVariant,
  ],
  runs: 3, // pass^k, N≥3
  traceDir: "benchmark-traces/recitation-ablation",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}
