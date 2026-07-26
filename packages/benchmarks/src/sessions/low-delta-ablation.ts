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
// READ THE GUARD-FIRE RATE FIRST. The mechanism-level signal (how often
// `low_delta_guard` terminates a run with artifacts already produced) is a
// per-run observable, not a per-task one, so it is far better powered than the
// accuracy delta. If the reset works, that rate must drop; if it does not drop,
// the accuracy comparison is not worth reading at all.

import type { BenchmarkSession } from "../types.js"

/** The ablation env var read by kernel/assessment/guard-adapters.ts. */
const EVIDENCE_RESET_ENV = "REACTIVE_AGENTS_EVIDENCE_DELTA_RESET"

const RA_FULL = { tools: true, reasoning: true, reactiveIntelligence: true, memory: true } as const

export const lowDeltaAblationSession: BenchmarkSession = {
  id: "low-delta-ablation",
  name: "low_delta_guard evidence-delta reset (lift measurement)",
  version: "1.0.0",
  tiers: ["real-world"],
  models: [
    { id: "qwen3-4b", provider: "ollama", model: "qwen3:4b", contextTier: "local" },
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
  taskIds: ["rw-4", "rw-6", "rw-7", "rw-8", "rw-10"],
  runs: 2,
  traceDir: "benchmark-traces/low-delta-ablation",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}
