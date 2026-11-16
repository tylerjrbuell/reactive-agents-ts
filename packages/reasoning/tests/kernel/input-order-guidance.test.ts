// Run: bun test packages/reasoning/tests/kernel/input-order-guidance.test.ts --timeout 15000
//
// Read-before-write order for listed inputs (harness switch `inputCoverage`,
// default OFF; no new flag). The input-coverage ablation showed coverage alone
// is not enough: the reads came AFTER the writes. A pass that writes a file
// while listed inputs are unread now appends one guidance line naming each
// unread input (kernel/loop/iterate-input-order-seam.ts, wired into the
// `ics-nudge` turn operation). Guidance only: no veto, no exit-gate change.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { makeKernelState } from "../../src/testing/kernel-fixtures.js";
import {
  applyInputOrderGuidance,
  inputOrderLine,
  unreadListedInputs,
} from "../../src/kernel/loop/iterate-input-order-seam.js";
import { SEAM_TURN_OPERATIONS, openTurnScope } from "../../src/kernel/loop/turn-operations.js";
import type { IterationConfig } from "../../src/kernel/loop/iterate-pass.js";
import type { KernelContext } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const FILES = ["inv-01.json", "inv-02.json", "inv-03.json"].map((f) => `invoices/${f}`);
const TASK = `Three invoice files are in your working directory:
${FILES.map((f) => `- ${f}`).join("\n")}
Read every one, then write audit.json with one entry per invoice.`;

let seq = 0;
function call(name: string, args: Record<string, unknown>): ReasoningStep[] {
  const id = `o${++seq}`;
  return [
    makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
    makeStep("observation", "ok", { toolCallId: id, observationResult: makeObservationResult(name, true, "ok") }),
  ];
}

const stateOf = (steps: readonly ReasoningStep[], opts: { readonly inputCoverage: boolean }) =>
  makeKernelState({
    iteration: 3,
    steps: [...steps],
    meta: { runContract: compileRunContract(TASK, opts.inputCoverage ? { inputCoverage: true } : {}) },
  });

/** The scenario from the spike: the deliverable is written before the last listed file is read. */
const WROTE_EARLY: ReasoningStep[] = [
  ...call("file-read", { path: FILES[0] }),
  ...call("file-read", { path: FILES[1] }),
  ...call("file-write", { path: "audit.json", content: "[]" }),
];

describe("input order guidance (inputCoverage on)", () => {
  it("names the unread listed input when a file is written before it was read", () => {
    const state = stateOf(WROTE_EARLY, { inputCoverage: true });
    expect(unreadListedInputs(state)).toEqual([FILES[2]]);
    const line = inputOrderLine(state, 0);
    expect(line).toContain(FILES[2]);
    expect(line).not.toContain(FILES[0]);
    expect(applyInputOrderGuidance(state, 0).pendingGuidance?.icsGuidance).toContain(FILES[2]);
  });

  it("says nothing when the pass did not write (a read is the right move)", () => {
    const state = stateOf(WROTE_EARLY, { inputCoverage: true });
    expect(inputOrderLine(state, WROTE_EARLY.length)).toBeUndefined();
    expect(applyInputOrderGuidance(state, WROTE_EARLY.length)).toBe(state);
  });

  it("says nothing once every listed input was read before the write", () => {
    const state = stateOf([...call("file-read", { path: FILES[2] }), ...WROTE_EARLY], { inputCoverage: true });
    expect(unreadListedInputs(state)).toEqual([]);
    expect(inputOrderLine(state, 0)).toBeUndefined();
  });

  it("appends to guidance already pending instead of replacing it", () => {
    const base = stateOf(WROTE_EARLY, { inputCoverage: true });
    const seeded = { ...base, pendingGuidance: { icsGuidance: "earlier steer", errorRecovery: "keep me" } };
    const out = applyInputOrderGuidance(seeded, 0).pendingGuidance;
    expect(out?.icsGuidance).toContain("earlier steer");
    expect(out?.icsGuidance).toContain(FILES[2]);
    expect(out?.errorRecovery).toBe("keep me");
  });

  it("the ics-nudge turn operation applies it (the seam is wired, not just exported)", async () => {
    const t = openTurnScope({
      state: { ...stateOf(WROTE_EARLY, { inputCoverage: true }), status: "acting" },
      currentInput: { task: TASK },
      currentOptions: { maxIterations: 5, strategy: "reactive" },
      currentContext: {} as KernelContext,
      prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
      prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
      failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: [], autoCheckpointed: false,
      mutableScratchpad: new Map(),
    });
    t.pass.stepsAtPassStart = 0;
    await Effect.runPromise(
      // status "acting" skips the ICS coordinator, so no profile is read.
      SEAM_TURN_OPERATIONS["ics-nudge"](t, {} as IterationConfig) as Effect.Effect<unknown>,
    );
    expect(t.state.pendingGuidance?.icsGuidance).toContain(FILES[2]);
  });
});

describe("input order guidance (inputCoverage off, the default)", () => {
  it("is inert: no InputRead conditions compile, so no guidance line", () => {
    const state = stateOf(WROTE_EARLY, { inputCoverage: false });
    expect(unreadListedInputs(state)).toEqual([]);
    expect(inputOrderLine(state, 0)).toBeUndefined();
    expect(applyInputOrderGuidance(state, 0)).toBe(state);
  });
});
