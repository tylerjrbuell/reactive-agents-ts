// File: src/sessions/low-delta-ablation.ts
//
// low_delta_guard evidence-delta reset — the lift measurement (2026-07-26).
//
// WHY THIS EXISTS. The live real-world sweep found `low_delta_guard` terminating
// 5 of 9 traced runs, every one with 3–5 artifacts already produced. rw-7's
// trace ends at the exact turn the model said "Now let me run the tests to see
// which ones fail:" (tokenDelta 188, 6 file-reads + 1 file-write done); rw-4's
// ended after fetching posts, fetching comments and computing the enriched array
// (tokenDelta 0, artifactsAvailable 4). The guard measures TOKEN delta, which is
// ~0 precisely when a model emits short tool calls against large results — the
// audit 02-#3 misfire.
//
// The fix already exists: `nextLowDeltaCount` (kernel/assessment/guard-adapters)
// also resets the counter when `assessment.evidenceDelta > 0`. It is opt-in
// behind the long-horizon profile per Wave E2's lift-gate discipline, because
// making it default-on is a per-task-class lift-rule decision (09 §6) and the
// lift rule needs a measurement. This session IS that measurement.
//
// ARMS. Two otherwise-identical `ra-full` variants; the only difference is the
// ablation env var the candidate sets via `config.env` (applied and restored per
// arm by runSession — the generalised VERIFIER_ENV seam):
//
//   • low-delta-legacy    — guard counts token delta alone (today's default)
//   • low-delta-evidence  — a new-evidence iteration also resets the counter
//
// LOCAL MODEL on purpose. The misfire is a TERSE-MODEL tax: it fires when a
// model emits few tokens per iteration while doing real work, which is the local
// tier's normal shape. Frontier models emit long turns and rarely trip it, so
// measuring there would under-detect the effect this arm targets.
//
// ONE SUT MODEL, deliberately. An earlier draft of this session listed two local
// models. On this rig that is a measurement hazard, not just a slow one: the
// harness-warden probe (`.agents/skills/harness-improvement-loop/scripts/
// local-bench-narrow-2026-07-26.ts`) documented qwen3:4b + cogito:8b + a 12b
// judge exceeding the 16GB card, forcing a CPU/GPU split and repeated model
// evictions — which inflates duration and can time a cell out for reasons that
// have nothing to do with the guard. One resident SUT keeps the arms comparable.
// To add a second model, run this session again with `--models <id>`, so only
// one is resident at a time.
//
// TASKS. The real-world tasks whose traces showed the guard firing, plus two it
// did not fire on as a control that the arm does not simply make everything
// slower. A task the guard never touches contributes only noise to the delta.
//
// POWER, STATED UP FRONT. 2 arms × 5 tasks × n=2 = 20 runs, 10 per arm. Per-run
// accuracy is close to Bernoulli, so the per-arm SE is roughly 15pp: this
// session can detect a LARGE effect and cannot resolve the 3pp lift-rule
// threshold. It is scoped to answer the question the traces raise — "does the
// guard stop killing runs mid-progress, and does that change outcomes at all?"
// — not to certify a marginal default-on.
//
// ── THAT GUIDANCE WAS WRONG. Measured 2026-07-27, corrected here.
//
// This header used to say: read the guard-fire rate FIRST, because it is a
// per-run observable and therefore better powered than the accuracy delta, and
// if the rate does not drop the accuracy comparison is not worth reading.
//
// Both halves of that are false for this mechanism. On claude-haiku, n=12 per
// arm, the fire rate barely moved — 11/12 → 7/12, Fisher two-tailed p = 0.155,
// not significant — while graded accuracy went 0.000 → 0.417 at p = 0.00002.
// Following the old instruction would have discarded a decisive result on the
// strength of a null one.
//
// The reason is that the reset does not mainly PREVENT the guard firing; it
// DELAYS it, so the run completes its work before the guard trips. Fire-rate is
// a proxy for the mechanism engaging, not for the mechanism helping. Read the
// OUTCOME.
//
// Fire rate is still worth reading for one thing: whether the mechanism ran at
// all. Zero fires in both arms means the arm is inert and the comparison is
// void — which is exactly what the local tier and gpt-4o-mini both turned out
// to be. See wiki/Research/Harness-Reports/low-delta-2026-07-27/RESULT.md.

import type { BenchmarkSession } from "../types.js"

/** The ablation env var read by kernel/assessment/guard-adapters.ts. */
const EVIDENCE_RESET_ENV = "REACTIVE_AGENTS_EVIDENCE_DELTA_RESET"

const RA_FULL = { tools: true, reasoning: true, reactiveIntelligence: true, memory: true } as const

export const lowDeltaAblationSession: BenchmarkSession = {
  id: "low-delta-ablation",
  name: "low_delta_guard evidence-delta reset (lift measurement)",
  version: "1.0.0",
  tiers: ["real-world"],
  // RETARGETED 2026-07-27 after three VOID local arm-sets. The local tier
  // cannot trip this guard at all: qwen3:4b and qwen3:14b both emit long
  // per-iteration reasoning, so `tokenDelta` never approaches the 500
  // threshold and `low_delta_guard` fired ZERO times in either arm — a
  // measurement of nothing. The misfire is a TERSE-model tax, and the traces
  // that found it were claude-haiku. Measuring where the defect does not occur
  // was the original design error; this is the correction.
  // TWO tiers because the lift rule (09 §6) requires it before any default-on,
  // and because a one-provider result cannot separate the mechanism from an
  // Anthropic-specific output shape. Both are TERSE frontier models: that is the
  // population the misfire lives in, since the guard measures token delta and
  // only fires when a model says little while doing much.
  models: [
    {
      id: "haiku",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      contextTier: "frontier",
    },
    {
      id: "gpt4o-mini",
      provider: "openai",
      model: "gpt-4o-mini",
      contextTier: "frontier",
    },
  ],
  harnessVariants: [
    {
      type: "internal",
      id: "low-delta-legacy",
      label: "low_delta (token delta only)",
      config: { ...RA_FULL },
    },
    {
      type: "internal",
      id: "low-delta-evidence",
      label: "low_delta (+ evidence reset)",
      config: { ...RA_FULL, env: { [EVIDENCE_RESET_ENV]: "1" } },
    },
  ],
  // rw-7 is the ONLY remaining exposure, and rw-4 is the control that proves it.
  //
  // Both traces originally showed the misfire. Since then the guard also
  // declines to fire while a DECLARED deliverable is unproduced, which covers
  // rw-4's shape (it must produce `output.ts`) — confirmed live 2026-07-27:
  // rw-4 on haiku ran 34 iterations / 12 tool calls and `low_delta_guard` never
  // fired, terminating on max_iterations instead. rw-7 declares no file
  // deliverable (its criterion is `bun test` exit 0), so nothing shields it.
  //
  // Keeping rw-4 in is what makes this a measurement rather than a hope: if the
  // guard fires on rw-4 too, the deliverable shield has regressed and the rw-7
  // comparison is not what it appears to be.
  taskIds: ["rw-7", "rw-4"],
  runs: 3,
  traceDir: "benchmark-traces/low-delta-ablation",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}
