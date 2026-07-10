// File: src/sessions/feature-coverage.ts
//
// One-feature-at-a-time attribution over the DETERMINISTIC graded tasks.
//
// Why this session exists (feature-coverage audit, 2026-07-09): the bench could
// reach 10 of the builder's 90 methods, and `ra-full` bundles several mechanisms
// at once. When `ra-full` beats `manual-react`, nothing tells us WHICH mechanism
// earned the lift — or which one is dead weight paying token cost. Measured on
// cogito:8b the same day: ra-full +5.1pp accuracy at **+224% tokens**. That is a
// bundle, not a finding.
//
// Each arm here is `ra-full` plus exactly ONE additional capability, so lift is
// attributable to a named mechanism. `ra-full` itself is the baseline arm.
//
// Task set is deliberately the three graded, deterministic tasks (rw-4, rw-8,
// rw-9). No LLM judge: judged tasks score 0/1 in practice (sd ~0.50), and the
// gate's own `runsNeeded` then demands ~556 runs/arm for a 3pp verdict. Graded
// partial credit measured sd ~0.257 → ~147 runs/arm. Even that is far above the
// `runs` below, so **expect `underpowered` verdicts** until the run count grows:
// the gate now says so out loud rather than rubber-stamping noise.
//
// Run:
//   bun run src/run.ts --session feature-coverage --provider ollama \
//     --model cogito:8b --runs 3 --output <path> --gate ra-full,ra-grounding

import type { BenchmarkSession, HarnessVariant } from "../types.js"
import { getVariant } from "../session.js"

/** `ra-full`'s config, plus one named capability. Keeps arms differing by ONE knob. */
const RA_FULL_CONFIG = {
  tools: true,
  reasoning: true,
  reactiveIntelligence: true,
  memory: true,
} as const

const withFeature = (
  id: string,
  label: string,
  extra: Record<string, unknown>,
): HarnessVariant => ({
  type: "internal",
  id,
  label,
  config: { ...RA_FULL_CONFIG, ...extra },
})

export const featureCoverageSession: BenchmarkSession = {
  id: "feature-coverage",
  name: "Per-feature attribution (ra-full + one capability)",
  version: "1.0.0",
  // The graded, deterministic subset. Judge-scored tasks are excluded on purpose:
  // they are Bernoulli and cannot support a lift verdict at any affordable n.
  taskIds: ["rw-4", "rw-8", "rw-9"],
  models: [
    { id: "cogito-8b", provider: "ollama", model: "cogito:8b", contextTier: "local" },
  ],
  harnessVariants: [
    getVariant("ra-full"), // baseline arm — the bundle, unchanged
    withFeature("ra-grounding", "RA Full + Grounding (block)", { grounding: "block" }),
    withFeature("ra-fabrication-guard", "RA Full + Fabrication Guard", { fabricationGuard: "block" }),
    withFeature("ra-verification", "RA Full + Verification pass", { verification: true }),
    withFeature("ra-meta-tools", "RA Full + Meta Tools", { metaTools: true }),
    withFeature("ra-stall-policy", "RA Full + Stall Policy", { stallPolicy: { ignoredNudgeTolerance: 2 } }),
    // The profile that gates the whole assessment -> control -> projector chain.
    // Until 2026-07-09 it was reachable only via a task tag that exactly ONE task
    // carries, so it could never be an arm.
    withFeature("ra-long-horizon", "RA Full + Long-Horizon profile", { longHorizon: true }),
    // The low-overhead arm: NOT ra-full + a feature, but the minimal guard set.
    // Included because the +224% token overhead above makes "what does the full
    // harness cost?" a first-class question, not a footnote.
    { type: "internal", id: "ra-lean", label: "RA Lean Harness", config: { tools: true, reasoning: true, leanHarness: true } },
  ],
  runs: 3,
  traceDir: "benchmark-traces/feature-coverage",
  concurrency: 1,
  timeoutMs: 300_000,
  logLevel: "progress",
}
