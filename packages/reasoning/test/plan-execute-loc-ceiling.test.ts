// Run: bun test packages/reasoning/test/plan-execute-loc-ceiling.test.ts --timeout 10000
//
// WS-6 Phase 3 — plan-execute.ts LOC ceiling (anti-regression).
//
// PREMISE
// -------
// `packages/reasoning/src/strategies/plan-execute.ts` hosts
// `executePlanExecute()` — the structured-plan engine used by the
// `plan-execute-reflect` strategy and (via composition) by `adaptive`. Around
// the orchestrator body, plan-execute.ts had accreted several helpers
// (step executor, plan mutation, output utilities) that each carry a single
// cohesive responsibility but inflate the file beyond the "one orchestrator
// per module" threshold.
//
// Pre-Phase-3 baseline: 1,578 LOC. Master plan:
// `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §3
// drift table line 470 + §5.5a re-baseline (2026-05-29 Branch A).
//
// WS-6 Phase 3 bucket-extracts the internal helpers to a sibling
// `plan-execute/` directory in three cohesive groups:
//   A) plan mutation   (patchPlan + augmentPlan)
//      → strategies/plan-execute/plan-mutation.ts
//   B) output utilities (extractGoalText + stripFinalAnswerPrefix +
//      sanitizeToolOutput + ACTION_TOOL_PATTERNS)
//      → strategies/plan-execute/output-utils.ts
//   C) step executor   (executeStep + StepExecResult interface)
//      → strategies/plan-execute/step-executor.ts
//
// External callers continue importing `executePlanExecute` from
// `strategies/plan-execute.js` (3 sites: index.ts, services/strategy-registry,
// strategies/adaptive). No caller import paths change.
//
// CEILING DERIVATION
// ------------------
// Pre-Phase-3 baseline: 1,578 LOC.
// Naive arithmetic: 1578 − (A:~114 + B:~123 + C:~290) ≈ 1,051. Re-add
// ~25–40 LOC of imports + helper re-exports. Initial target: 1,300 LOC (must),
// 1,200 LOC (stretch).
//
// Post-Phase-3 empirical landing is honestly measured below. Headroom is
// intentionally thin so post-Phase-3 drift triggers this ceiling before it
// accumulates. If a legitimate addition to `executePlanExecute()` orchestration
// is required, raise CEILING in this file AND add a rationale comment.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const PLAN_EXECUTE_PATH = resolve(
  REPO_ROOT,
  "packages/reasoning/src/strategies/plan-execute.ts",
);

const CEILING = 1300;

describe("WS-6 Phase 3 — plan-execute.ts LOC ceiling", () => {
  it(`plan-execute.ts stays ≤ ${CEILING} LOC after helper bucket extraction`, () => {
    const src = readFileSync(PLAN_EXECUTE_PATH, "utf-8");
    // Count lines the same way `wc -l` does — trailing newline notwithstanding,
    // the `split("\n").length - 1` of a file that ends in "\n" equals the
    // `wc -l` count for that file.
    const trimmed = src.endsWith("\n") ? src.slice(0, -1) : src;
    const lines = trimmed.split("\n").length;

    if (lines > CEILING) {
      throw new Error(
        `plan-execute.ts is ${lines} LOC (ceiling: ${CEILING}).\n` +
          `Either:\n` +
          `  1. Bucket-extract additional helpers to ` +
          `strategies/plan-execute/<bucket>.ts following the WS-6 Phase 3 pattern, OR\n` +
          `  2. If the addition is a legitimate new orchestration concern in ` +
          `executePlanExecute(), raise CEILING in this test and add a rationale ` +
          `comment referencing the WS-6 follow-up plan.`,
      );
    }
    expect(lines).toBeLessThanOrEqual(CEILING);
  });
});
