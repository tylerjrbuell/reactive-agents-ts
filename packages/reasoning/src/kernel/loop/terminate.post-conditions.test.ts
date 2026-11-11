// Coverage for the #7 headline behavior made live by the runner.ts:250 seed
// flip (RA_POST_CONDITIONS === "1"  ->  !== "0"): the terminal PostCondition
// hard-stop in terminate() now fires BY DEFAULT.
//
// Pre-flip, runner.ts seeded state.meta.postConditions only under "=1", so on a
// default (unset) run terminate()'s gate read undefined and was INERT. These
// tests pin the post-flip contract at the single-owner termination gateway:
//   - a STORED unmet condition demotes a forced imperative termination to
//     status:"failed" (honest partial failure), regardless of opts.reason;
//   - a STORED met condition passes through to status:"done";
//   - the env gate is default-on (unset/anything-but-"0" active) and opt-out
//     ("0") restores the legacy byte-identical pass-through.
//
// terminate() reads conditions only off state.meta.postConditions (the same set
// the runner seeds and the Arbitrator's steer gate reads); these tests seed
// that field directly to exercise the gate in isolation — pure, no LLM, no fs.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initialKernelState } from "../state/kernel-state.js";
import type { KernelState } from "../state/kernel-state.js";
import { terminate } from "./terminate.js";
import { modelSynthesisDeliverable, sentinelDeliverable } from "@reactive-agents/core";
import { UNRESOLVED_DELIVERABLE } from "../capabilities/reason/unresolved-tool-call.js";
import type { RunLedger } from "../ledger/run-ledger.js";
import {
  artifactProduced,
  toolCalled,
} from "../capabilities/verify/post-conditions.js";
import type { ReasoningStep } from "../../types/index.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../utils/observation-helpers.js";

/** P1 mission 2B: terminate() now takes a typed Deliverable, not a raw string.
 *  Wrap a plain answer string as model_synthesis so deliverableToContent
 *  reproduces it byte-for-byte. */
function answer(text: string) {
  return modelSynthesisDeliverable({ type: "thought", content: text, iteration: 0 });
}

const ORIGINAL = process.env.RA_POST_CONDITIONS;

beforeEach(() => {
  delete process.env.RA_POST_CONDITIONS;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.RA_POST_CONDITIONS;
  else process.env.RA_POST_CONDITIONS = ORIGINAL;
});

/** A successful write observation tied (via toolCallId) to a write action that
 *  named `path` — the ledger shape that satisfies ArtifactProduced(path). */
function writtenLedger(path: string): ReasoningStep[] {
  const id = "call_1";
  return [
    makeStep("action", "", {
      toolCall: { id, name: "file-write", arguments: { path } },
    }),
    makeStep("observation", "", {
      toolCallId: id,
      observationResult: makeObservationResult("file-write", true, ""),
    }),
  ];
}

function stateWith(
  meta: Partial<KernelState["meta"]>,
  steps: ReasoningStep[] = [],
): KernelState {
  const base = initialKernelState({
    strategy: "reactive",
    kernelType: "reactive",
    maxIterations: 10,
  });
  return { ...base, steps, meta: { ...base.meta, ...meta } };
}

describe("terminate() terminal PostCondition gate — default-on (#7 seed flip)", () => {
  it("DEFAULT (env unset): a STORED unmet condition demotes a forced termination to failed", () => {
    const state = stateWith({ postConditions: [toolCalled("file-write")] }); // never called
    const result = terminate(state, {
      reason: "harness_deliverable",
      deliverable: answer("Here is the finished work."),
    });

    expect(result.status).toBe("failed");
    expect(result.output).toBeNull(); // transitionState nulls output on failure
    expect(result.error).toContain("Post-condition");
    expect(result.error).toContain("file-write");
    expect(result.meta.terminatedBy).toBe("harness_deliverable");
  });

  it("DEFAULT: a STORED met condition passes through to done", () => {
    const state = stateWith(
      { postConditions: [artifactProduced("./out.md"), toolCalled("file-write")] },
      writtenLedger("/abs/dir/out.md"),
    );
    const result = terminate(state, {
      reason: "harness_deliverable",
      deliverable: answer("Wrote ./out.md."),
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Wrote ./out.md.");
  });

  // Sprint-1 A4 (2026-06-02): opt-out via RA_POST_CONDITIONS=0 removed
  // alongside the flag itself; gate is unconditional. The legacy pass-through
  // case is no longer reachable.

  it("no stored conditions (empty/absent): byte-identical pass-through to done", () => {
    const state = stateWith({}); // no postConditions seeded at all
    const result = terminate(state, {
      reason: "loop_graceful",
      deliverable: answer("Nothing to verify."),
    });

    expect(result.status).toBe("done");
    expect(result.output).toBe("Nothing to verify.");
  });
});

// Owner decision 2026-11-10: the harness never writes text into `output`. A
// sentinel deliverable (the harness's own sentence) on a non-pause, non-abstain
// terminal means "no answer": the run fails with EMPTY output and the rendered
// sentinel as its cause on `error`. RED on the old code: terminate() committed
// the sentinel sentence as the output of a `done` run.
describe("terminate() — a sentinel is a cause, never the output", () => {
  const sentinel = (detail: string) => sentinelDeliverable("no_substantive_output", detail);

  it("tool_call_unresolved: failed, empty output, the unresolved cause on error", () => {
    const result = terminate(stateWith({}), { reason: "tool_call_unresolved", deliverable: UNRESOLVED_DELIVERABLE });
    expect(result.status).toBe("failed");
    expect(result.output == null || result.output === "").toBe(true);
    expect(result.error ?? "").toContain("could not produce a valid tool call");
    expect(result.meta.terminatedBy).toBe("tool_call_unresolved");
  });

  it("oracle_forced / loop_graceful sentinels: failed with the sentinel as the cause", () => {
    for (const reason of ["oracle_forced", "loop_graceful", "harness_deliverable"] as const) {
      const result = terminate(stateWith({}), { reason, deliverable: sentinel(`${reason} detail`) });
      expect(result.status).toBe("failed");
      expect(result.output == null || result.output === "").toBe(true);
      expect(result.error ?? "").toContain(`${reason} detail`);
      expect(result.meta.terminatedBy).toBe(reason);
    }
  });

  it("an unmet post-condition keeps the sentinel cause first and names the unmet condition", () => {
    const state = stateWith({ postConditions: [toolCalled("file-write")] });
    const result = terminate(state, { reason: "loop_graceful", deliverable: sentinel("loop detail") });
    expect(result.status).toBe("failed");
    expect(result.error ?? "").toContain("loop detail");
    expect(result.error ?? "").toContain("Post-condition(s) unmet");
  });

  it("a verified declared artifact IS the deliverable: done with empty output, no harness sentence", () => {
    const ledger: RunLedger = [
      { kind: "requirement", seq: 0, iteration: 0, requirementId: "artifact:./out.md", status: "declared", requirementKind: "artifact-produced" },
      { kind: "requirement", seq: 1, iteration: 1, requirementId: "artifact:./out.md", status: "satisfied" },
    ];
    const result = terminate({ ...stateWith({}), ledger }, { reason: "oracle_forced", deliverable: sentinel("oracle forced exit") });
    expect(result.status).toBe("done");
    expect(result.output ?? "").toBe("");
    expect(result.error ?? null).toBeNull();
  });

  it("pause and abstain sentinels keep their own handling", () => {
    const paused = terminate(stateWith({}), { reason: "awaiting-approval", deliverable: sentinelDeliverable("awaiting_approval") });
    expect(paused.status).toBe("done");
    expect(paused.output).toBe("Run paused — awaiting human approval.");
    const abstained = terminate(stateWith({}), { reason: "abstained", deliverable: sentinel("no evidence") });
    expect(abstained.status).toBe("done");
    expect(abstained.output).toBe("");
    expect(abstained.error ?? "").toContain("no evidence");
  });
});
