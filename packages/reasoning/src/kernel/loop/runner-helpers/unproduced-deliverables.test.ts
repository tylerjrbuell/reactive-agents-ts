// Run: bun test packages/reasoning/src/kernel/loop/runner-helpers/unproduced-deliverables.test.ts
//
// An early-exit guard must not end a run with a declared deliverable unwritten
// (2026-07-26).
//
// Live witness — bench rw-4, claude-haiku. The task: fetch posts by user 3 from
// JSONPlaceholder, enrich with comment counts, write `output.ts`. The trace
// shows the agent doing the work:
//
//   http-get  .../posts?userId=3        ok
//   http-get  .../comments              ok
//   code-execute  → result: Array(10)   the enriched posts
//   code-execute  → comment counts      ok
//
// and then:
//
//   guard-fired  low_delta_guard  terminate
//     { tokenDelta: 0, consecutiveLowDeltaCount: 3, artifactsAvailable: 4 }
//
// The run ended at iteration 3, before writing output.ts, and scored 0:
// "output.ts exports no array". The guard already refuses to fire while a
// REQUIRED TOOL is uncalled; a declared deliverable is the same class of fact
// and nothing consulted it.
//
// RED-ON-CUT: return `[]` unconditionally from unproducedDeliverables and the
// unwritten-deliverable cases below fail.
import { describe, expect, it } from "bun:test";
import { unproducedDeliverables } from "./deliverable.js";
import { initialKernelState, transitionState, type KernelState } from "../../state/kernel-state.js";
import { compileRunContract } from "../../contract/run-contract.js";
import type { RunLedger } from "../../ledger/run-ledger.js";

/**
 * Built through the REAL constructors (`initialKernelState` + `transitionState`
 * + `compileRunContract`) rather than a cast literal, so these cases exercise
 * the same state shape the loop does and cannot drift from it.
 */
function stateWith(opts: {
  /** Task prose — the contract is COMPILED from it, as the runner does. */
  readonly prompt: string;
  readonly ledger?: RunLedger;
  /** Omit the contract entirely (the pre-contract / skipped-compile path). */
  readonly noContract?: boolean;
}): KernelState {
  const base = initialKernelState({
    maxIterations: 5,
    strategy: "reactive",
    kernelType: "react",
    taskId: "t",
  });
  return transitionState(base, {
    ...(opts.ledger ? { ledger: opts.ledger } : {}),
    meta: opts.noContract
      ? base.meta
      : { ...base.meta, runContract: compileRunContract(opts.prompt) },
  });
}

describe("unproducedDeliverables", () => {
  it("CONTROL: no contract → empty, so guards behave exactly as before", () => {
    expect(unproducedDeliverables(stateWith({ prompt: "Write output.ts", noContract: true }))).toEqual([]);
  });

  it("CONTROL: a contract with no FILE deliverable → empty", () => {
    expect(unproducedDeliverables(stateWith({ prompt: "What is the capital of France?" }))).toEqual([]);
  });

  it("names a declared file that was never written", () => {
    expect(unproducedDeliverables(stateWith({ prompt: "Write a TypeScript module to output.ts" })))
      .toEqual(["./output.ts"]);
  });

  it("is empty once the file IS written (ledger artifact)", () => {
    const s = stateWith({
      prompt: "Write a TypeScript module to output.ts",
      ledger: [{ kind: "artifact", seq: 0, iteration: 0, op: "write", path: "/tmp/run/output.ts" }],
    });
    expect(unproducedDeliverables(s)).toEqual([]);
  });

  it("credits a deliverable written by a SUB-AGENT", () => {
    const s = stateWith({
      prompt: "Write a TypeScript module to output.ts",
      ledger: [{
        kind: "artifact", seq: 0, iteration: 0, op: "write",
        path: "/tmp/run/output.ts", pass: "sub-agent:writer",
      }],
    });
    expect(unproducedDeliverables(s)).toEqual([]);
  });

  it("does NOT credit a delete", () => {
    const s = stateWith({
      prompt: "Write a TypeScript module to output.ts",
      ledger: [{ kind: "artifact", seq: 0, iteration: 0, op: "delete", path: "/tmp/run/output.ts" }],
    });
    expect(unproducedDeliverables(s)).toEqual(["./output.ts"]);
  });

  it("reports only the files still missing on a multi-file contract", () => {
    const s = stateWith({
      prompt: "Write a.ts, then write b.ts, then write c.ts",
      ledger: [{ kind: "artifact", seq: 0, iteration: 0, op: "write", path: "/tmp/run/b.ts" }],
    });
    expect(unproducedDeliverables(s)).toEqual(["./a.ts", "./c.ts"]);
  });
});
