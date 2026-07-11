// File: src/sessions/reliability.ts
//
// pass^8 reliability probe — the session that makes pass^8 COMPUTABLE.
//
// pass^k shipped in 269996fb (C(c,k)/C(n,k), honest-absent when n < k), and the
// gate carries a pass^8 non-regression hook — but no registered session ran
// n ≥ 8, so pass^8 was structurally absent from every report ever produced.
// A reliability metric no session can feed is a decoration. This session is
// the missing producer: every cell carries n = 8, so k ∈ {1,2,4,8} all emit.
//
// TASK CHOICE — graded + deterministic only:
//  - rw-4, rw-7, rw-9: hidden-fixture verifiable checks with partial credit.
//    Deterministic scoring means the run-to-run variance pass^8 measures is
//    the MODEL/HARNESS's, not an LLM judge's Bernoulli noise on top.
//  - Solves use the strict bar (accuracy ≥ 1 — ALL hidden checks pass), so
//    pass^8 here is exactly tau-bench "ships 8 times in a row".
//  - lh-1 (the mission's other graded example) is deliberately excluded: its
//    1800s wall × 8 runs ≈ 4h worst-case for ONE cell, and it needs live
//    web-search. "Cheap" is a requirement here, not a preference.
//
// Run (local, no keys):
//   bun run src/run.ts --session reliability --output <path>

import type { BenchmarkSession } from "../types.js"
import { getVariant } from "../session.js"

export const reliabilitySession: BenchmarkSession = {
  id: "reliability",
  name: "pass^8 reliability probe (graded deterministic tasks, n=8 per cell)",
  version: "1.0.0",
  taskIds: ["rw-4", "rw-7", "rw-9"],
  models: [
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: [getVariant("ra-full")],
  // n = 8 is the whole point: pass^8 needs 8 runs per cell or it is absent.
  runs: 8,
  traceDir: "benchmark-traces/reliability",
  concurrency: 1,
  timeoutMs: 420_000,
  logLevel: "progress",
}
