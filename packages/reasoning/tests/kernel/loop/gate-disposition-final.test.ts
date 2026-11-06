// Run: bun test packages/reasoning/tests/kernel/loop/gate-disposition-final.test.ts --timeout 20000
//
// The exit gate's disposition is final for the pass (Plan 9: the exit gate is
// the only run ender). Found in Phase 4 stage 2 (iterate-pass split into
// turn-guard-operations.ts): an accepted / handed-off exit did not always end
// the pass, so `required-tools-guard` — the one operation that reopens a
// `done` state — could redirect a run the gate had already ended back to
// thinking, discarding the handoff.
//
// Two paths reach that hazard:
//   1. The oracle-gate operation (oracle_forced) took the gate's disposition
//      but returned "next", so the rest of the turn ran on the terminal state.
//   2. A gate handoff minted INSIDE the think step (the termination oracle's
//      `controller_early_stop` verdict proposes as a soft guard) reaches the
//      later guards as plain state, never as a returned disposition.
//
// Scripted and zero-token: the real oracle-gate and required-tools-guard
// operations run over recording stubs for every other operation.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import {
  KERNEL_TURN_OPERATIONS,
  SEAM_TURN_OPERATIONS,
  openTurnScope,
  runKernelTurn,
  type TurnOperation,
  type TurnOperationImpls,
  type TurnScope,
} from "../../../src/kernel/loop/turn-operations.js";
import { GUARD_TURN_OPERATIONS } from "../../../src/kernel/loop/turn-guard-operations.js";
import type { IterationConfig } from "../../../src/kernel/loop/iterate-pass.js";
import { DISPATCHER_EARLY_STOP, proposeExit } from "../../../src/kernel/loop/exit-gate.js";
import { makeStep } from "../../../src/kernel/capabilities/sense/step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../../src/kernel/state/kernel-state.js";

const REAL_OPS: TurnOperationImpls = { ...SEAM_TURN_OPERATIONS, ...GUARD_TURN_OPERATIONS };
const REQUIRED = ["file-write"] as const;
const INPUT: KernelInput = { task: "Research octopuses and write the facts to ./notes.md", requiredTools: [...REQUIRED] };
const OPTIONS = { maxIterations: 8, strategy: "reactive" } as const;
const DRAFT =
  "Octopuses have three hearts, blue copper-based blood, and nine brains: one central brain plus a ganglion in each of the eight arms.";
const REDIRECT_TEXT = "Required tools not yet used";

/**
 * A live run mid-flight: one model draft (handoff material), the run's one
 * guard deny-once already spent, and the required `file-write` never called.
 * Any soft exit the gate sees now is disposed `handoff`.
 */
function midRunState(): KernelState {
  const base = initialKernelState({ ...OPTIONS, kernelType: "react" });
  return transitionState(base, {
    status: "thinking",
    iteration: 3,
    output: DRAFT,
    steps: [
      makeStep("thought", DRAFT),
      makeStep("harness_signal", "earlier nudge", {
        exitGate: { proposedBy: "low_delta_guard", gateDecision: "deny-once", reason: "low_delta_guard", outstanding: ["call the `file-write` tool"] },
      }),
    ],
  });
}

function scopeOf(state: KernelState): TurnScope {
  return openTurnScope({
    state,
    currentInput: INPUT,
    currentOptions: OPTIONS,
    currentContext: {} as KernelContext,
    prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
    prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
    failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: [], autoCheckpointed: false,
    mutableScratchpad: new Map(),
  });
}

// Partial on purpose: only the fields the real oracle-gate / required-tools-guard read.
const cfg = {
  profile: { tier: "mid" },
  horizon: undefined,
  requiredTools: [...REQUIRED] as readonly string[],
  maxRequiredToolRetries: 2,
  emitLog: () => Effect.void,
} as IterationConfig;

/** Real implementations for `real`, recording stubs (or `overrides`) for the rest. */
function opsWith(
  calls: string[],
  real: readonly string[],
  overrides: Partial<Record<string, TurnOperation>> = {},
): TurnOperationImpls {
  const ops: Record<string, TurnOperation> = {};
  for (const { name } of KERNEL_TURN_OPERATIONS) {
    const impl: TurnOperation | undefined =
      overrides[name] ?? (real.includes(name) ? (REAL_OPS[name] as TurnOperation) : undefined);
    ops[name] = (t, c) => {
      calls.push(name);
      return impl ? impl(t, c) : Effect.succeed("next");
    };
  }
  return ops as TurnOperationImpls;
}

function expectNoReopen(t: TurnScope): void {
  expect(t.state.status).toBe("done");
  expect(t.state.steps.some((s) => s.content.includes(REDIRECT_TEXT))).toBe(false);
  expect(t.requiredToolRedirects).toBe(0);
}

describe("an exit-gate disposition is final for the pass", () => {
  it("oracle-gate: a handed-off oracle_forced exit ends the pass; no later guard runs", async () => {
    const calls: string[] = [];
    const t = scopeOf(transitionState(midRunState(), { readyToAnswerNudgeCount: 2 }));
    const signal = await Effect.runPromise(
      runKernelTurn(t, cfg, opsWith(calls, ["oracle-gate", "required-tools-guard"], {
        // The lane and pulse facts the oracle reads, as the real seams would set them.
        "execution-lane": (s) => {
          s.pass.laneDecision = { lane: "synthesize", canFinalize: true, missingRequiredTools: [] };
          return Effect.succeed("next");
        },
        "ics-nudge": (s) => {
          s.pass.oracleReady = true;
          return Effect.succeed("next");
        },
      })),
    );
    expect(t.state.steps.filter((s) => s.metadata?.exitGate?.gateDecision === "handoff")).toHaveLength(1);
    expectNoReopen(t);
    expect(signal).toBe("break");
    expect(calls.at(-1)).toBe("oracle-gate");
    expect(calls).not.toContain("required-tools-guard");
    expectNoReopen(t);
  });

  it("required-tools-guard: a handoff the gate minted inside the think step is not redirected back to thinking", async () => {
    const calls: string[] = [];
    const t = scopeOf(midRunState());
    await Effect.runPromise(
      runKernelTurn(t, cfg, opsWith(calls, ["required-tools-guard"], {
        // The termination oracle's controller_early_stop verdict inside think:
        // a soft guard proposal the gate hands off (deny-once already spent).
        think: (s) =>
          Effect.gen(function* () {
            const gated = yield* proposeExit({
              state: s.state,
              proposal: {
                ...DISPATCHER_EARLY_STOP,
                deliverable: modelSynthesisDeliverable({ type: "thought", content: DRAFT, iteration: s.state.iteration }),
              },
              input: INPUT,
              maxIterations: OPTIONS.maxIterations,
              taskId: "t",
            });
            s.state = gated.state;
            return "next" as const;
          }),
      })),
    );
    expect(t.state.steps.filter((s) => s.metadata?.exitGate?.gateDecision === "handoff")).toHaveLength(1);
    expect(calls).toContain("required-tools-guard");
    expectNoReopen(t);
  });

  it("required-tools-guard still redirects a plain kernel done that skipped a required tool (no gate involved)", async () => {
    const calls: string[] = [];
    const t = scopeOf(midRunState());
    await Effect.runPromise(
      runKernelTurn(t, cfg, opsWith(calls, ["required-tools-guard"], {
        think: (s) => {
          s.state = transitionState(s.state, { status: "done" });
          return Effect.succeed("next");
        },
      })),
    );
    expect(t.state.status).toBe("thinking");
    expect(t.state.steps.at(-1)?.content).toContain(REDIRECT_TEXT);
    expect(t.requiredToolRedirects).toBe(1);
  });
});
