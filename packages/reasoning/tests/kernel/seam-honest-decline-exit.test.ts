// Run: bun test packages/reasoning/tests/kernel/seam-honest-decline-exit.test.ts --timeout 20000
//
// Measurement overhaul Phase 0 item 0.4: an honest decline over an input that
// always errored is an ABSTENTION carrying the model's own text, never a failure
// labelled "stopped before the model wrote a final answer" (ab-trap-5). The
// rule lives in the shared exit gate (kernel/loop/exit-gate.ts), so every guard
// proposal (here the dispatcher early-stop) gets it.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { proposeExit, DISPATCHER_EARLY_STOP } from "../../src/kernel/loop/exit-gate.js";
import { passthroughOutputDeliverable } from "../../src/kernel/loop/runner-helpers/deliverable.js";
import { deriveTerminatedBy } from "../../src/kernel/loop/terminate-reason.js";
import { honestDeclineOf, declineSettlesOutstanding } from "../../src/kernel/loop/honest-decline-exit.js";
import { looksLikeHonestDecline } from "../../src/kernel/capabilities/decide/abstention-detection.js";
import { makeKernelInput, makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const DECLINE = "I cannot determine the total because ./ledger.json could not be found.";
const INPUT = makeKernelInput({ task: "Sum the amounts in ./ledger.json", requiredTools: ["file-read"] });

const readResult = (success: boolean, error = "ENOENT: no such file"): ReasoningStep =>
  makeStep("observation", success ? "amount=1" : error, {
    observationResult: { success, toolName: "file-read" },
  } as never);

const stateWith = (steps: ReasoningStep[]): KernelState =>
  makeKernelState({ iteration: 3, llmCalls: 3, steps, output: steps.at(-1)?.content ?? "" });

const stop = (state: KernelState) =>
  Effect.runPromise(
    proposeExit({
      state,
      proposal: { ...DISPATCHER_EARLY_STOP, deliverable: passthroughOutputDeliverable(state.output) },
      input: INPUT,
      maxIterations: 10,
      taskId: "t",
    }),
  );

const failedReads = [readResult(false), readResult(false), readResult(false)];

describe("seam-honest-decline-exit: a guard's stop over an always-failing required tool", () => {
  it("decline after an always-failing required tool -> abstained, model text kept as output", async () => {
    const { state, decision } = await stop(stateWith([...failedReads, makeStep("thought", DECLINE)]));
    expect(decision).toBe("accept");
    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).toBe("abstained");
    expect(deriveTerminatedBy(state).terminatedBy).toBe("abstained");
    expect(state.output).toBe(DECLINE);
    expect(state.meta.abstention).toEqual({ reason: DECLINE, missing: ["file-read"] });
    expect(state.error ?? null).toBeNull();
  });

  it("premature stop: the tool never failed (never called) -> unchanged, not abstained", async () => {
    const { state } = await stop(stateWith([makeStep("thought", DECLINE)]));
    expect(state.meta.terminatedBy).not.toBe("abstained");
    expect(state.status).not.toBe("done");
  });

  it("a single TRANSIENT failure is not 'always errored' -> unchanged", async () => {
    const { state } = await stop(stateWith([readResult(false, "Error: request timed out"), makeStep("thought", DECLINE)]));
    expect(state.meta.terminatedBy).not.toBe("abstained");
  });

  it("a single PERMANENT failure (ENOENT) + decline -> abstained (gemma ab-trap-5 shape)", async () => {
    const { state } = await stop(stateWith([readResult(false), makeStep("thought", DECLINE)]));
    expect(state.meta.terminatedBy).toBe("abstained");
    expect(state.output).toBe(DECLINE);
  });

  it("a permanent failure mixed with a transient one needs two calls", () => {
    const steps = [readResult(false, "Error: connection reset"), makeStep("thought", DECLINE)];
    expect(honestDeclineOf(stateWith(steps), INPUT, ["call the `file-read` tool"])).toBeUndefined();
  });

  it("the tool succeeded once this run -> unchanged", async () => {
    const steps = [readResult(false), readResult(true), readResult(false), makeStep("thought", DECLINE)];
    expect(honestDeclineOf(stateWith(steps), INPUT, ["call the `file-read` tool"])).toBeUndefined();
  });

  it("partial answer that is not a decline -> unchanged", async () => {
    const partial = "The total so far is 120 from the first rows, but I cannot read the rest of ./ledger.json.";
    const { state } = await stop(stateWith([...failedReads, makeStep("thought", partial)]));
    expect(state.meta.terminatedBy).not.toBe("abstained");
  });

  it("a plain non-decline text after failures -> unchanged", async () => {
    const { state } = await stop(stateWith([...failedReads, makeStep("thought", "Let me try reading the file again.")]));
    expect(state.meta.terminatedBy).not.toBe("abstained");
  });

  it("a decline written BEFORE a later successful read is stale -> unchanged", () => {
    const steps = [...failedReads, makeStep("thought", DECLINE), readResult(true)];
    expect(honestDeclineOf(stateWith(steps), INPUT, ["call the `file-read` tool"])).toBeUndefined();
  });
});

describe("looksLikeHonestDecline", () => {
  it("accepts a missing-input decline; rejects figures, answers and long text", () => {
    expect(looksLikeHonestDecline(DECLINE)).toBe(true);
    expect(looksLikeHonestDecline("Unable to compute the sum: the file does not exist.")).toBe(true);
    expect(looksLikeHonestDecline("The total is 3.14")).toBe(false);
    expect(looksLikeHonestDecline("The total is 420, but ledger.json could not be found")).toBe(false);
    expect(looksLikeHonestDecline("Here is the summary of the report.")).toBe(false);
    expect(looksLikeHonestDecline("")).toBe(false);
    expect(looksLikeHonestDecline(`${DECLINE} ${"x ".repeat(400)}`)).toBe(false);
  });
});

describe("declineSettlesOutstanding: act-or-answer must not force a read the model declined", () => {
  const permanentlyFailed = (s: KernelState): KernelState =>
    ({ ...s, evidence: { ...s.evidence, permanentlyFailed: new Set(["file-read"]) } }) as KernelState;

  it("same conditions as the gate (even when the tool is marked permanently failed) -> settled", () => {
    const s = permanentlyFailed(stateWith([...failedReads, makeStep("thought", DECLINE)]));
    expect(declineSettlesOutstanding(s, INPUT, ["file-read"])).toBe(true);
    expect(declineSettlesOutstanding(s, INPUT, ["file-read"], DECLINE)).toBe(true);
  });

  it("one ENOENT then a decline settles (no forced second read)", () => {
    const s = permanentlyFailed(stateWith([readResult(false), makeStep("thought", DECLINE)]));
    expect(declineSettlesOutstanding(s, INPUT, ["file-read"])).toBe(true);
  });

  it("not settled: tool succeeded once, a single failure, a partial answer, or other outstanding work", () => {
    const ok = stateWith([readResult(false), readResult(true), readResult(false), readResult(false), makeStep("thought", DECLINE)]);
    expect(declineSettlesOutstanding(ok, INPUT, ["file-read"])).toBe(false);
    expect(declineSettlesOutstanding(stateWith([readResult(false, "Error: timed out"), makeStep("thought", DECLINE)]), INPUT, ["file-read"])).toBe(false);
    const s = permanentlyFailed(stateWith(failedReads));
    expect(declineSettlesOutstanding(s, INPUT, ["file-read"], "The total is 412.")).toBe(false);
    expect(declineSettlesOutstanding(s, INPUT, ["file-read", "file-write"], DECLINE)).toBe(false);
  });
});
