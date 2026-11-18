/**
 * Shape 4: a correct answer vetoed as fabrication (rw-6). The model benchmarks a
 * sort at two sizes, then extrapolates a third timing by arithmetic ("100000 items
 * takes 650 ms", without citing the measured values) and concludes nothing needs
 * optimizing. The figure is derived, not invented, but no tool printed it, so the
 * always-on fabricated-measurement check (verifier.ts, Check 4c) rejects a
 * unit-bearing number the evidence lacks.
 * The naive model repeats the answer; a model that follows harness steering
 * drops the extrapolated figure.
 *
 * Source: bench task rw-6 (S3: the one task discriminative on every tier, and the
 * per-task veto candidate on v019-rerun/strat-switch) and trace attribution rule
 * `harness:false-veto` / `model:fabrication-vetoed` (packages/trace/src/attribution.ts).
 */
import { obeys } from "../compliance.js";
import { seenText, type PolicyModel } from "../policy-model.js";
import type { Shape } from "../shape.js";

const BENCH = { toolCall: { name: "code-execute", args: { code: "bench(sort, [1000, 10000])" } } } as const;
const EXTRAPOLATED =
  "Sorting scales as n log n, so 100000 items takes 650 ms. It is already optimal; nothing needs optimizing.";
const CLEAN = "Sorting scales as n log n, and the two measured runs agree with that. It is already optimal; nothing needs optimizing.";

const policy: PolicyModel = (req, ctx) => {
  const follows = obeys(req, ctx.rng, ctx.compliance);
  const seen = seenText(req);
  if (!seen.includes("55 ms")) return BENCH;
  return follows ? { text: CLEAN } : { text: EXTRAPOLATED };
};

export const fabricationVeto: Shape = {
  id: "fabrication-veto",
  sourceTraceId: "bench:rw-6 (S3 per-task veto candidate, qwen3:4b/cogito:8b); attribution model:fabrication-vetoed",
  task: "Benchmark the sort function at 1000 and 10000 items with code-execute, estimate the time at 100000 items, and say whether it needs optimizing.",
  tools: [
    {
      name: "code-execute",
      description: "Run code and return its output.",
      parameters: [{ name: "code", type: "string", required: true }],
      run: () => ({ ok: true, result: { stdout: "n=1000: 4.5 ms\nn=10000: 55 ms", exitCode: 0 } }),
    },
  ],
  policy,
  ideal: { terminatedBy: "end_turn", status: "completed", toolSeq: ["code-execute"], maxTurns: 3 },
  run: { maxIterations: 6, requiredTools: ["code-execute"], tier: "mid" },
};
