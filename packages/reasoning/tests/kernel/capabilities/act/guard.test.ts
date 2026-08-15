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

describe("repetitionGuard — distinct-target carve-out (2026-08-15 rw-7 finding)", () => {
  function stateWithFileWrites(paths: string[]): KernelState {
    const steps = paths.map((path) => ({
      type: "action",
      metadata: { toolCall: { name: "file-write", arguments: { path, content: "x" } } },
    }));
    return makeState({ steps: steps as any, meta: {} as any });
  }

  it("does not block a 3rd file-write call when it targets a NEW path (multi-file edit task)", () => {
    const fwInput = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 4 } } as KernelInput;
    const thirdCall = { name: "file-write", arguments: { path: "/tmp/pipeline.ts", content: "fixed" } } as any;
    const outcome = repetitionGuard(thirdCall, stateWithFileWrites(["/tmp/validator.ts", "/tmp/processor.ts"]), fwInput);
    expect(outcome.pass).toBe(true);
  });

  it("still blocks a 3rd file-write call when it re-targets an ALREADY-written path (genuine repetition)", () => {
    const fwInput = { requiredToolQuantities: {}, nextMovesPlanning: { maxBatchSize: 4 } } as KernelInput;
    const thirdCall = { name: "file-write", arguments: { path: "/tmp/validator.ts", content: "retry" } } as any;
    const outcome = repetitionGuard(thirdCall, stateWithFileWrites(["/tmp/validator.ts", "/tmp/processor.ts"]), fwInput);
    expect(outcome.pass).toBe(false);
  });
});
