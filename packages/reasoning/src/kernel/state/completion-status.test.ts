// Run: bun test packages/reasoning/src/kernel/state/completion-status.test.ts
//
// H5 / P0 (wiring audit 2026-07-09). The harness could ship an UNVERIFIED answer
// and report it to the caller as a clean success.
//
// `runner.ts:1220-1232` (`onlyHarnessAuthorshipFailed`): when the terminal
// verifier fails ONLY the `output-is-model-authored` check — i.e. the harness
// concatenated a deliverable the model never wrote — the code deliberately keeps
// `status:"done"`. `reactive.ts` then mapped `done → "completed"`, and
// `reasoning-post-think.ts:85` derives `success = status === "completed"`.
// Net: `result.success === true` beside `verified: false`.
//
// The code comment promised the run would "ship it HONESTLY LABELED … a
// verification warning + harnessAuthoredOutput surface to receipts/telemetry".
// It did not. Both markers were dead:
//   • `harnessAuthoredOutput` — never even DECLARED on the meta type (written
//     through an `as KernelState["meta"]` cast), zero readers.
//   • `verificationWarning` — zero readers, absent from `extraMetadata`.
//   • `budgetTerminalPartial` — same disease, written at pace-terminal.ts:137,
//     read nowhere.
//
// This module is the single honest channel: a run that shipped output the
// verifier did not bless is `partial`, never `completed`. Downstream, that makes
// `result.success === false` by the existing mapping — no new flag to remember.

import { describe, expect, it } from "bun:test";
import { resolveCompletionStatus, shippedUnverified } from "./completion-status.js";
import type { KernelState } from "./kernel-state.js";

const state = (
  status: KernelState["status"],
  meta: Partial<KernelState["meta"]> = {},
): KernelState => ({ status, meta } as KernelState);

describe("shippedUnverified — did the harness ship something the verifier did not bless?", () => {
  it("harness-authored output (the 01KWZ811 stack) counts as unverified", () => {
    expect(shippedUnverified({ harnessAuthoredOutput: true })).toBe(true);
  });

  it("a budget-terminal partial counts as unverified", () => {
    expect(shippedUnverified({ budgetTerminalPartial: true })).toBe(true);
  });

  it("a clean run does not", () => {
    expect(shippedUnverified({})).toBe(false);
    expect(shippedUnverified({ harnessAuthoredOutput: false })).toBe(false);
  });

  it("a bare verificationWarning alone does NOT demote", () => {
    // `verificationWarning` also rides the grounding-DEGRADE path, which is an
    // explicit, documented "surface the answer with a warning" policy — not an
    // unverified ship. Only the two hard markers demote.
    expect(shippedUnverified({ verificationWarning: "grounding degraded" })).toBe(false);
  });
});

describe("resolveCompletionStatus — the honest completed/partial/failed mapping", () => {
  it("done + verified → completed (the default path is unchanged)", () => {
    expect(resolveCompletionStatus(state("done"))).toBe("completed");
  });

  it("P0: done + harness-authored output → PARTIAL, never completed", () => {
    expect(resolveCompletionStatus(state("done", { harnessAuthoredOutput: true }))).toBe(
      "partial",
    );
  });

  it("P0: done + budget-terminal partial → PARTIAL", () => {
    expect(resolveCompletionStatus(state("done", { budgetTerminalPartial: true }))).toBe(
      "partial",
    );
  });

  it("failed stays failed (an unverified ship never upgrades a failure)", () => {
    expect(resolveCompletionStatus(state("failed", { harnessAuthoredOutput: true }))).toBe(
      "failed",
    );
  });

  it("any other kernel status is partial", () => {
    expect(resolveCompletionStatus(state("thinking"))).toBe("partial");
  });
});
