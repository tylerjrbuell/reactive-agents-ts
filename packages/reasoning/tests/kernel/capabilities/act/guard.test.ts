import { describe, it, expect } from "bun:test";
import { repetitionGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import type { KernelState, KernelInput } from "../../../../src/kernel/state/kernel-state.js";

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    iteration: 3, steps: [], meta: {}, taskId: "t1",
    ...overrides,
  } as KernelState;
}

const tc = { name: "web-search", arguments: { query: "season 1 episodes" } } as any;
const input = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 4 } } as KernelInput;

function stateWithPriorCalls(n: number, stallCount: number): KernelState {
  const steps = Array.from({ length: n }, (_, i) => ({
    type: "action",
    metadata: { toolCall: { name: "web-search", arguments: { query: `q${i}` } } },
  }));
  return makeState({
    steps: steps as any,
    meta: { assessment: { requirementProgress: new Map([["answer", { stallCount }]]) } } as any,
  });
}

describe("repetitionGuard — stall-aware ceiling (FM-16 layer D-guard)", () => {
  it("does not block while stallCount is below the escalation-exhausted threshold", () => {
    const outcome = repetitionGuard(tc, stateWithPriorCalls(4, 1), input);
    expect(outcome.pass).toBe(true);
  });

  it("blocks with a requirement-naming nudge once stallCount exceeds the threshold", () => {
    const outcome = repetitionGuard(tc, stateWithPriorCalls(4, 5), input);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain("answer");
      expect(outcome.observation).not.toBe("⚠️ You have already called web-search 4 times. Stop repeating this tool. Use final-answer to respond now.");
    }
  });
});
