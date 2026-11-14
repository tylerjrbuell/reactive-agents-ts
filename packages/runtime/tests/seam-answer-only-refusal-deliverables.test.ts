// Run: bun test packages/runtime/tests/seam-answer-only-refusal-deliverables.test.ts --timeout 20000
//
// False-veto reconciliation (local-model campaign 2026-11-13, gpt-oss rw-4:
// output.ts written, hidden grader 1.0, run marked failure). The kernel minted
// a `partial` outcome whose ONLY refusal was `answerSatisfied: false` (the last
// turn was not an answer-shaped message). When every declared deliverable
// verifiably landed, the artifacts are the answer, so the K1 terminal-outcome
// veto in deriveExecutionSuccess must not fire.
//
// RED-ON-CUT: drop the `!deliverablesAreTheAnswer(reconciled)` conjunct in
// engine/execute-success-invariants.ts -> the "deliverable landed" pin goes red.
// Counter-pins stay green under the cut (honest failures keep failing).
import { describe, it, expect } from "bun:test";
import { deriveExecutionSuccess } from "../src/engine/execute-success-invariants.js";
import { runtimeStatusAuthority } from "../src/engine/finalize/status-authority.js";
import type { ExecutionContext } from "../src/types.js";
import { makeExecutionContext, makeRuntimeConfig, makeTask } from "../src/testing/index.js";

const TASK = "Write the enriched posts module to the file ./output.ts.";
const LANDED = [{ kind: "artifact", seq: 0, iteration: 15, path: "./output.ts", op: "write" }];

const outcome = (over: Record<string, unknown>) => ({
  status: "partial",
  terminatedBy: "max_iterations",
  provenance: "model-final",
  verdict: null,
  answerSatisfied: false,
  success: false,
  outstanding: [],
  ...over,
});

const derive = (terminalOutcome: Record<string, unknown>, runLedger: readonly unknown[] | undefined) => {
  const ctx = makeExecutionContext();
  const rr: ExecutionContext["metadata"]["reasoningResult"] = {
    status: "partial",
    output: "We need to write output.ts ...",
    metadata: {
      cost: 0,
      tokensUsed: 0,
      stepsCount: 0,
      terminatedBy: "max_iterations",
      extensions: { terminalOutcome },
      ...(runLedger !== undefined ? { runLedger: runLedger as never } : {}),
    },
  };
  const res = deriveExecutionSuccess({
    ctx,
    task: makeTask({ id: "t", input: { question: TASK } }),
    config: makeRuntimeConfig(),
    rr,
    hasSubstantiveOutput: true,
    outputForSuccess: "We need to write output.ts ...",
  });
  return { ok: res.executionSucceeded, authority: runtimeStatusAuthority(ctx.metadata as Record<string, unknown>) };
};

describe("seam: answer-only terminal refusal + landed deliverables is not a failure", () => {
  it("deliverable landed, answerSatisfied=false is the sole refusal -> success", () => {
    const r = derive(outcome({}), LANDED);
    expect(r.ok).toBe(true);
    expect(r.authority).toBeUndefined();
  });

  it("counter-pin: deliverable declared but NOT produced -> still failure", () => {
    const r = derive(outcome({}), []);
    expect(r.ok).toBe(false);
    expect(r.authority).toBe("runtime-success-veto:terminal-outcome");
  });

  it("counter-pin: a rejected verdict still vetoes even with the deliverable landed", () => {
    const r = derive(outcome({ verdict: { accepted: false, summary: "fabricated action claim" } }), LANDED);
    expect(r.ok).toBe(false);
    expect(r.authority).toBe("runtime-success-veto:terminal-outcome");
  });

  it("counter-pin: a failed verifier verdict still vetoes even with the deliverable landed", () => {
    const r = derive(outcome({ verifierVerdict: { verified: false, failedChecks: ["grounded"] } }), LANDED);
    expect(r.ok).toBe(false);
  });

  it("counter-pin: an outstanding requirement still vetoes even with the deliverable landed", () => {
    const r = derive(outcome({ outstanding: ["tool:http-get"] }), LANDED);
    expect(r.ok).toBe(false);
  });
});
