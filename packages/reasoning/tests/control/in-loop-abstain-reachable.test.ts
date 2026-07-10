// Run: bun test packages/reasoning/tests/control/in-loop-abstain-reachable.test.ts
//
// The in-loop abstain proposal was UNREACHABLE in production, which makes every
// control-plane seam that consults it inert — including the two I added today.
//
// `deriveInLoopForcedAbstention` computes:
//
//     ungroundedSynthesisRejections = synthesisRetryCount + groundingBlockRetry
//
// and `decideForcedAbstention` fires that branch at `>= FORCE_UNGROUNDED_THRESHOLD`
// (= 2). But in production, mid-loop:
//
//   • `synthesisRetryCount` is capped at 1  (arbitrator.ts: SYNTHESIS_RETRY_MAX = 1)
//   • `groundingBlockRetry` is incremented ONLY in the runner's POST-loop
//     terminal-verify block (runner.ts ~1135), so it is 0 while the loop runs
//
// Max mid-loop sum = 1 < 2. The other branch needs
// `requiredToolUnavailable && iterationsRemaining <= 0`, and `iterationsRemaining`
// is 0 mid-loop only at `iteration === 0` — before the F3 seam (needs >= 2
// identical tool failures) and before the stall seam (`iteration >= 2`) can run.
//
// So `inLoopAbstentionProposal` returns null at EVERY seam that calls it: the F3
// seam (a102bcc9), the stall seam (69c4ef9e), and the original strategy-switch
// seam (the P5 fix). The resolver only ever sees the seam's own proposal, and
// behaviour is identical to not consulting it at all.
//
// My seam tests passed because they SET `meta.synthesisRetryCount = 2` directly —
// a value production caps at 1. Unit-testing f() with inputs f can never receive.
//
// The fix mirrors what the POST-loop derivation already does (runner.ts:795-803):
// count `groundingRedirectCount`, the one counter that DOES increment mid-loop
// (arbitrator.ts:1417, at the grounded-terminal gate). A run that has been
// redirected for ungrounded terminal output AND spent its synthesis retry has
// made two rejected ungrounded attempts — exactly what the threshold means.

import { describe, expect, it } from "bun:test";
import { deriveInLoopForcedAbstention } from "../../src/kernel/control/abstention-proposal.js";
import { FORCE_UNGROUNDED_THRESHOLD } from "../../src/kernel/loop/runner-helpers/force-abstention.js";
import type { KernelState, KernelInput } from "../../src/kernel/state/kernel-state.js";

const TOOL = { name: "file-read", description: "read a file", parameters: {} };

/** A mid-loop state: ungrounded (no successful substantive call), no deliverable. */
const stateAt = (
  iteration: number,
  meta: Record<string, unknown> = {},
): KernelState =>
  ({
    status: "thinking",
    iteration,
    steps: [],
    ledger: [],
    messages: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    meta: { ...meta },
  }) as unknown as KernelState;

const input = (allTools: readonly { name: string }[] = [TOOL]): KernelInput =>
  ({ task: "t", allToolSchemas: allTools, availableToolSchemas: allTools }) as unknown as KernelInput;

const MAX_ITER = 8;

describe("the production caps make the in-loop ungrounded branch unreachable", () => {
  it("SYNTHESIS_RETRY_MAX is 1, so synthesisRetryCount alone cannot reach the threshold", () => {
    expect(FORCE_UNGROUNDED_THRESHOLD).toBe(2);
    // The realistic mid-loop maximum: one synthesis retry, zero grounding-block
    // retries (that counter only moves post-loop).
    const forced = deriveInLoopForcedAbstention(
      stateAt(3, { synthesisRetryCount: 1, groundingBlockRetry: 0 }),
      input(),
      ["file-read"],
      MAX_ITER,
    );
    expect(forced).toBeNull();
  });

  it("at the F3 seam (iteration >= 1) a required-tool-unavailable run still does NOT abstain", () => {
    // iterationsRemaining = max(0, 8 - 1) = 7 > 0, so that branch is closed too.
    const forced = deriveInLoopForcedAbstention(
      stateAt(1),
      input(), // "employee-directory" is required but absent
      ["employee-directory"],
      MAX_ITER,
    );
    expect(forced).toBeNull();
  });

  it("at the stall seam (iteration >= 2) likewise", () => {
    const forced = deriveInLoopForcedAbstention(stateAt(2), input(), ["employee-directory"], MAX_ITER);
    expect(forced).toBeNull();
  });

  it("ONLY iteration 0 with an unavailable required tool abstains today (pre-loop, before any seam)", () => {
    const forced = deriveInLoopForcedAbstention(stateAt(0), input(), ["employee-directory"], MAX_ITER);
    expect(forced).not.toBeNull();
  });
});

describe("groundingRedirectCount is the mid-loop signal the derivation ignored", () => {
  it("a redirected, ungrounded run WITH its synthesis retry spent now abstains mid-loop", () => {
    // grounding redirect (1, bumped at arbitrator.ts:1417) + synthesis retry (1)
    // = 2 rejected ungrounded terminal attempts = FORCE_UNGROUNDED_THRESHOLD.
    const forced = deriveInLoopForcedAbstention(
      stateAt(3, { groundingRedirectCount: 1, synthesisRetryCount: 1 }),
      input(),
      ["file-read"],
      MAX_ITER,
    );
    expect(forced).not.toBeNull();
    expect(forced!.reason).toContain("ground");
  });

  it("a single grounding redirect alone does NOT abstain (one rejection is not two)", () => {
    const forced = deriveInLoopForcedAbstention(
      stateAt(3, { groundingRedirectCount: 1 }),
      input(),
      ["file-read"],
      MAX_ITER,
    );
    expect(forced).toBeNull();
  });

  it("a GROUNDED run never abstains, however many redirects it accumulated", () => {
    // A successful substantive tool call means the run is grounded; the counter
    // is stale history, not evidence of an ungrounded terminal.
    const grounded = stateAt(3, { groundingRedirectCount: 1, synthesisRetryCount: 1 });
    (grounded as unknown as { toolsUsed: Set<string> }).toolsUsed = new Set(["file-read"]);
    (grounded as unknown as { steps: unknown[] }).steps = [
      {
        id: "s1",
        type: "observation",
        content: "ok",
        metadata: { observationResult: { toolName: "file-read", success: true } },
      },
    ];
    expect(deriveInLoopForcedAbstention(grounded, input(), ["file-read"], MAX_ITER)).toBeNull();
  });

  it("a run holding a deliverable never abstains (unchanged guarantee)", () => {
    const withDeliverable = stateAt(3, { groundingRedirectCount: 1, synthesisRetryCount: 1 });
    (withDeliverable as unknown as { steps: unknown[] }).steps = [
      {
        id: "s1",
        type: "observation",
        content: "here is the answer",
        metadata: { observationResult: { toolName: "web-search", success: true } },
      },
    ];
    expect(deriveInLoopForcedAbstention(withDeliverable, input(), ["file-read"], MAX_ITER)).toBeNull();
  });
});
