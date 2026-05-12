// File: src/sessions/m3-ablation.ts
//
// M3 verifier ablation — Phase 1.5 pre-Phase-B gate.
//
// Isolates the contribution of the §9.0 verifier gate to end-task accuracy by
// running the same 10 real-world tasks under two otherwise-identical variants:
//
//   • ra-full                 — full harness, defaultVerifier active
//   • ra-full-noop-verifier   — full harness, verifier replaced by noopVerifier
//
// Dispatch fan-out: 3 models × 2 variants × 10 tasks × n=1 = 60 dispatches.
//
// Models span tiers: 2 local Ollama (qwen3:14b, cogito:14b) + 1 frontier
// (gpt-4o-mini). The verifier's accuracy contribution may differ by tier —
// smaller local models tend to ship malformed/empty outputs that the verifier
// catches and routes back through retry; frontier models tend to self-correct
// upstream. Both signals matter for the M3 verdict.
//
// Concurrency 1 and runs 1: this is a single-shot ablation, not a regression
// gate. Variance analysis happens at the verdict-compile step (Task #5) by
// pooling task-level accuracy deltas. Re-running for n>1 is reserved for the
// follow-up reproducibility pass if the n=1 verdict is borderline.
//
// Judge: must be configured via `--judge-url` or `JUDGE_URL` (Rule 4). The
// runner's pre-flight probes /version and fails fast if the judge model
// collides with any SUT model.

import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

export const m3AblationSession: BenchmarkSession = {
  id: "m3-ablation",
  name: "M3 Verifier Ablation (Phase 1.5 pre-Phase-B gate)",
  version: "1.0.0",
  tiers: ["real-world"],
  models: [
    { id: "qwen3-14b",   provider: "ollama", model: "qwen3:14b",   contextTier: "local"    },
    { id: "cogito-14b",  provider: "ollama", model: "cogito:14b",  contextTier: "local"    },
    { id: "gpt-4o-mini", provider: "openai", model: "gpt-4o-mini", contextTier: "standard" },
  ],
  harnessVariants: [
    getVariant("ra-full"),
    getVariant("ra-full-noop-verifier"),
  ],
  runs: 1,
  traceDir: "benchmark-traces/m3-ablation",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}
