// File: src/sessions/adaptive-ablation.ts
//
// G3 adaptive-harness ablation — the gate that validates the meta-loop's crown
// (Phase 6 Policy Compiler): does turning on `.withAdaptiveHarness()` pay?
//
// The gate (plan Wave G, G3):
//
//     ra-adaptive  ≥  max(ra-minimal, ra-full)   per model × task class
//
// i.e. the adaptive harness must be at least as good as BOTH the lean baseline
// AND the always-full harness. Adaptive wins by DEEPENING scaffolding only when
// a run struggles and LEANING when it flows — so on easy cells it should match
// ra-minimal's economy, and on hard cells it should reach ra-full's accuracy,
// without paying full's overhead everywhere. The ablation-warden veto (project
// lift rule) stands: no default-on flip without ≥3pp lift AND ≤15% overhead.
//
// The THREE arms (defined INLINE — NOT added to the shared ABLATION_VARIANTS
// ladder, which would bloat every full sweep that spreads [...ABLATION_VARIANTS];
// see the note in session.ts):
//
//   • ra-minimal   — the LEAN baseline: {tools, reasoning} only. No reactive
//                    intelligence, no memory, no adaptive plan. This is the same
//                    config as the ladder's `ra-reasoning` arm; it is given the
//                    explicit id `ra-minimal` so the `≥ max(ra-minimal, ra-full)`
//                    gate reads directly off the arm ids. Justification for using
//                    tools+reasoning (rather than bare-llm) as the floor: the
//                    adaptive harness is a REASONING-loop policy — its cheapest
//                    compiled plan still runs the react loop with tools, so the
//                    honest "what does adaptivity add over NOT adapting" floor is
//                    the lean reasoning loop, not a single no-tools API call.
//   • ra-full      — the always-full harness: tools+reasoning+RI+memory, every
//                    scaffold on for every cell (the ladder's canonical ra-full).
//   • ra-adaptive  — ra-full's config PLUS `adaptiveHarness: true`: same surface,
//                    but the policy compiler owns strategy/budget/guard depth and
//                    recompiles mid-run on RunAssessment evidence.
//
// Models: qwen3:14b + cogito:8b, both contextTier "local" — the two local bench
// models the plan names for this gate. NOTE: qwen3:14b OOMs on the dev box, so
// the main thread runs this session PARTIALLY (cogito:8b first; qwen3:14b only
// where hardware allows). Use `--models cogito-8b` to run just the arm that fits.
//
// Tasks: the real-world execution set (rw-1, rw-2, rw-7, rw-8, rw-9) + lh-1 (the
// long-horizon research + multi-file deliverable) — the same set the public
// competitor bench uses, so the adaptive gate spans short AND long horizons. lh-1
// carries its own `timeoutSec` (see task def), so the shared wall does not apply.
//
// Judge: LIVE (Rule 4: judge ≠ SUT). Requires `--judge-url` or `JUDGE_URL`; the
// runner's preflight probes /version and fails fast on a judge/SUT collision.
//
// Fan-out: 2 models × 3 variants × 6 tasks × 3 runs = 108 dispatches (full).

import type { BenchmarkSession, HarnessVariant } from "../types.js"
import { getVariant } from "../session.js"

// Lean baseline: tools + reasoning, nothing else. Same config as `ra-reasoning`
// in the ladder, re-labelled `ra-minimal` so the gate arm ids are self-describing.
const raMinimalVariant: HarnessVariant = {
  type: "internal",
  id: "ra-minimal",
  label: "RA Minimal (tools + reasoning)",
  config: { tools: true, reasoning: true },
}

// Adaptive arm: ra-full config + the policy compiler. The ONLY difference from
// ra-full is `adaptiveHarness: true` (runner.ts calls builder.withAdaptiveHarness()).
const raAdaptiveVariant: HarnessVariant = {
  type: "internal",
  id: "ra-adaptive",
  label: "RA Adaptive (policy compiler)",
  config: {
    tools: true, reasoning: true, reactiveIntelligence: true, memory: true,
    adaptiveHarness: true,
  },
}

export const adaptiveAblationSession: BenchmarkSession = {
  id: "adaptive-ablation",
  name: "G3 Adaptive-Harness Ablation (ra-adaptive ≥ max(ra-minimal, ra-full))",
  version: "1.0.0",
  taskIds: ["rw-1", "rw-2", "rw-7", "rw-8", "rw-9", "lh-1"],
  models: [
    { id: "qwen3-14b", provider: "ollama", model: "qwen3:14b", contextTier: "local" },
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
    // Dev-box fitting tier: qwen3:14b OOMs on a 16GB box, so the two-tier gate is
    // run here as cogito:8b (8B) + qwen3:4b (4B) — two DISTINCT local tiers that
    // both fit VRAM. On adequate hardware run cogito-8b + qwen3-14b for the
    // canonical bar. Select the fitting pair with `--models cogito-8b,qwen3-4b`.
    { id: "qwen3-4b", provider: "ollama", model: "qwen3:4b", contextTier: "local" },
  ],
  harnessVariants: [
    raMinimalVariant,
    getVariant("ra-full"),
    raAdaptiveVariant,
  ],
  runs: 3, // pass^k, N≥3
  traceDir: "benchmark-traces/adaptive-ablation",
  concurrency: 1,
  // lh-1 carries its own timeoutSec; this wall covers the rw-* execution set.
  timeoutMs: 420_000,
  logLevel: "progress",
}
