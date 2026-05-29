// Run: bun test packages/reasoning/test/runner-loc-ceiling.test.ts --timeout 10000
//
// WS-6 Phase 2 — runner.ts LOC ceiling (anti-regression).
//
// PREMISE
// -------
// `packages/reasoning/src/kernel/loop/runner.ts` hosts `runKernel()` — the
// universal execution loop every reasoning strategy delegates to. Around the
// 200-LOC orchestrator body, runner.ts had accreted 15 helper functions
// (deliverable assembly, tier guards, recovery steering, state queries) that
// each have a single, cohesive responsibility but inflate the file beyond the
// "one orchestrator per module" threshold.
//
// Stage-5 baseline (post-Stage-5 re-org Apr 2026): 1,739 LOC.
// Drift before WS-6 Phase 2: 1,976 LOC (regrowth from added recovery/steering
// + tier-guard tier-aware thresholds + deliverable plumbing). Master plan:
// `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §3
// drift table line 468 + §5.5a re-baseline.
//
// WS-6 Phase 2 bucket-extracts the 15 internal helpers to a sibling
// `runner-helpers/` directory in four cohesive groups:
//   A) tier guards (TierGuardConfig, TIER_GUARD_THRESHOLDS, shouldExitOnLowDelta,
//      shouldForceOracleExit, resolveMaxSameTool)
//   B) deliverable assembly (Deliverable, assembleDeliverable + 5 collaborators)
//   C) recovery steering (buildRecoverySteeringGuidance, getToolFailureRecovery)
//   D) state queries (missingRequiredToolsForInput, resolveStoredToolObservation,
//      getLastPulseReadyToAnswer, getLastErrors)
//
// External callers (16 import sites) keep importing from `kernel/loop/runner.js`;
// runner.ts re-exports the 8 public symbols (runKernel, assembleDeliverable,
// Deliverable, TierGuardConfig, TIER_GUARD_THRESHOLDS, shouldExitOnLowDelta,
// shouldForceOracleExit, resolveMaxSameTool) so no caller import paths change.
//
// CEILING DERIVATION
// ------------------
// Pre-Phase-2 baseline: 1,976 LOC.
// Naive arithmetic: 1976 − (A:85 + B:120 + C:150 + D:80) ≈ 1,541. Re-add
// ~25-40 LOC of imports + re-exports. Initial target: 1,600 LOC.
//
// Post-Phase-2 empirical landing: 1,615 LOC after all four bucket extractions
// (tier-guards, state-queries, recovery-steering, deliverable). Ratified at
// 1,625 (+10 LOC headroom) per Phase 1 lessons-learned: body-size distribution
// is right-skewed, and load-bearing JSDoc + inline breadcrumbs inside
// `runKernel()` orchestration are protected verbatim by the WS-6 Phase 2
// MissionBrief. The original 1,600 target was sketched pre-extraction; 1,625
// is the honest measured landing plus thin headroom — same precedent shape as
// Phase 1 (target 2,050 → empirical 2,108 → ratified 2,115).
//
// Stretch target: ≤1,500 LOC abandoned — not attainable without violating
// the no-comment-deletion constraint. Future reductions would need to come
// from `runKernel()` body itself (e.g. lifting iteration-block code into a
// dedicated `iterate-pass.ts`), not from further helper extraction.
//
// Headroom is intentionally thin (~10 LOC) so post-Phase-2 drift triggers
// this ceiling before it accumulates. If a legitimate addition to
// `runKernel()` orchestration body is required, raise CEILING in this file
// AND rationale-comment the new addition.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const RUNNER_PATH = resolve(
  REPO_ROOT,
  "packages/reasoning/src/kernel/loop/runner.ts",
);

const CEILING = 1625;

describe("WS-6 Phase 2 — runner.ts LOC ceiling", () => {
  it(`runner.ts stays ≤ ${CEILING} LOC after helper bucket extraction`, () => {
    const src = readFileSync(RUNNER_PATH, "utf-8");
    // Count lines the same way `wc -l` does — trailing newline notwithstanding,
    // the `split("\n").length - 1` of a file that ends in "\n" equals the
    // `wc -l` count for that file.
    const trimmed = src.endsWith("\n") ? src.slice(0, -1) : src;
    const lines = trimmed.split("\n").length;

    if (lines > CEILING) {
      throw new Error(
        `runner.ts is ${lines} LOC (ceiling: ${CEILING}).\n` +
          `Either:\n` +
          `  1. Bucket-extract additional helpers to ` +
          `kernel/loop/runner-helpers/<bucket>.ts following the WS-6 Phase 2 pattern, OR\n` +
          `  2. If the addition is a legitimate new orchestration concern in ` +
          `runKernel(), raise CEILING in this test and add a rationale comment ` +
          `referencing the WS-6 follow-up plan.`,
      );
    }
    expect(lines).toBeLessThanOrEqual(CEILING);
  });
});
