// File: src/sessions/long-horizon-arm.ts
//
// The ablation that makes the 2026-07 harness work measurable.
//
// `.withLongHorizon()` used to be selected by a task TAG, and exactly one task
// (`lh-1`) carries it. So the profile could never be an arm: there was no way to
// run the same task with the profile on and off. Everything gated behind it was
// invisible to the bench, and no number of runs could fix that — a coverage hole
// is not a power problem.
//
// Both arms are identical except for `longHorizon`. What that single knob turns
// on, and therefore what this session measures as a BUNDLE:
//
//   • RunAssessment → phase inference → projector emphasis, including the
//     `verify` phase, which was unreachable until f466eb13.
//   • The F3 error-recovery control seam (a102bcc9): abstain now outranks the
//     redirect, so a run that cannot ground its answer declines immediately
//     instead of burning its redirect budget.
//   • The stall control seam (69c4ef9e): abstain outranks the stall guard's
//     steer, for the same reason.
//   • The A2 guard scaling (stall thresholds, nudge tolerances) that predates
//     today's work.
//
// HONESTY: this arm does NOT isolate the two seam fixes. It measures the whole
// long-horizon profile. Attributing a delta here to "the control-plane seams"
// alone would be wrong. Isolating them needs a separate knob; this session is
// the first step — making the bundle visible at all.
//
// TASK CHOICE. The seam fixes only change behaviour when FORCED ABSTENTION
// qualifies: the run is ungrounded, has no deliverable, and its
// ungrounded-synthesis retries are spent. The `ab-trap-*` tasks are exactly that
// shape — questions no honest agent can answer from its tools — and they are
// scored deterministically by `scoreAbstention` (abstain => 1.0, any answer =>
// 0.0). No LLM judge, so no Bernoulli judge noise on top of the Bernoulli score.
//
// rw-9 is included as a graded, deterministic control: the profile must not
// REGRESS a task that has nothing to do with abstention.
//
// Expected direction, stated before running (so the result can falsify it):
//   • trap tasks: accuracy equal or better (both arms should abstain), and the
//     long-horizon arm spends FEWER tokens, because it declines at the first
//     qualifying iteration instead of at the budget's end.
//   • rw-9: no regression.
//
// Run:
//   bun run src/run.ts --session long-horizon-arm --provider ollama \
//     --model cogito:8b --runs 3 --output <path> --gate ra-full,ra-long-horizon

import type { BenchmarkSession } from "../types.js"

/** ra-full's config. The candidate arm adds exactly one key. */
const RA_FULL_CONFIG = {
  tools: true,
  reasoning: true,
  reactiveIntelligence: true,
  memory: true,
} as const

export const longHorizonArmSession: BenchmarkSession = {
  id: "long-horizon-arm",
  name: "Long-horizon profile ablation (assessment chain + control-plane seams)",
  version: "1.0.0",
  // ab-trap-4 is the ONLY task that reaches harness-FORCED abstention (it
  // declares a required tool that does not exist). Measured 2026-07-09:
  // ab-trap-1..3 declare no requiredTools, so the grounded-terminal gate is
  // skipped and the model simply answers -- accuracy 0.0 in BOTH arms. They
  // measure fabrication, not the abstention machinery the seams changed.
  // ab-trap-5 is the MID-LOOP fixture: `file-read` is required, exists, and
  // always fails (the file never exists). The run stays ungrounded, the
  // grounded-terminal gate redirects, F3 trips on the identical failures, and
  // forced abstention qualifies DURING the loop -- where the F3 and stall seams
  // rank abstain above their own redirect/steer. This is the cell that measures
  // the seams. rw-9 is the deterministic no-regression control.
  taskIds: ["ab-trap-4", "ab-trap-5", "rw-9"],
  models: [
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: [
    { type: "internal", id: "ra-full", label: "RA Full (profile OFF)", config: { ...RA_FULL_CONFIG } },
    {
      type: "internal",
      id: "ra-long-horizon",
      label: "RA Full + Long-Horizon profile",
      config: { ...RA_FULL_CONFIG, longHorizon: true },
    },
  ],
  runs: 3,
  traceDir: "benchmark-traces/long-horizon-arm",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}
