import { describe, it, expect } from "bun:test";
import { repetitionGuard, unconsumedEvidenceGuard } from "../../../../src/kernel/capabilities/act/guard.js";
import type { KernelState, KernelInput } from "../../../../src/kernel/state/kernel-state.js";
import { setScratchpadBounded } from "@reactive-agents/tools";

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

describe("unconsumedEvidenceGuard — deterministic grounding, no recall() required (2026-08-16 root fix)", () => {
  const finalAnswerCall = { name: "final-answer", arguments: { output: "done" } } as any;

  function observationStep(storedKey: string | undefined) {
    return { type: "observation", metadata: { toolCallId: "c1", ...(storedKey ? { storedKey } : {}) } };
  }
  function actionStep(name: string, args: Record<string, unknown>) {
    return { type: "action", metadata: { toolCall: { id: "c1", name, arguments: args } } };
  }

  it("passes final-answer through when there is no unconsumed stored evidence", () => {
    const state = makeState({ steps: [], scratchpad: new Map() } as any);
    expect(unconsumedEvidenceGuard(finalAnswerCall, state).pass).toBe(true);
  });

  it("blocks the FIRST final-answer attempt and injects the FULL stored content when evidence is unconsumed", () => {
    const state = makeState({
      steps: [
        actionStep("http-get", { url: "https://example.com" }),
        observationStep("_tool_result_1"),
      ] as any,
      scratchpad: new Map([["_tool_result_1", "THE REAL EPISODE DATA: S1E1 Shark Survivor — real synopsis text"]]),
    } as any);
    const outcome = unconsumedEvidenceGuard(finalAnswerCall, state);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain("THE REAL EPISODE DATA");
      expect(outcome.observation).not.toContain("call recall");
    }
  });

  it("injects the full content of a SPILLED-TO-DISK evidence entry, not the raw marker string (health sweep 2026-08-16)", () => {
    const scratchpad = new Map<string, string>();
    const bigContent = "THE REAL EPISODE DATA: " + "x".repeat(200);
    // Force a spill regardless of content size (threshold=1 byte).
    setScratchpadBounded(scratchpad, "_tool_result_1", bigContent, "guard-test-spill", 1);
    expect(scratchpad.get("_tool_result_1")!.startsWith("[SPILLED_TO_DISK:")).toBe(true);

    const state = makeState({
      steps: [
        actionStep("http-get", { url: "https://example.com" }),
        observationStep("_tool_result_1"),
      ] as any,
      scratchpad,
    } as any);
    const outcome = unconsumedEvidenceGuard(finalAnswerCall, state);
    expect(outcome.pass).toBe(false);
    if (!outcome.pass) {
      expect(outcome.observation).toContain("THE REAL EPISODE DATA");
      expect(outcome.observation).not.toContain("[SPILLED_TO_DISK:");
    }
  });

  it("passes on the SECOND final-answer attempt even with evidence still unconsumed (no retry trap)", () => {
    const state = makeState({
      steps: [
        actionStep("http-get", { url: "https://example.com" }),
        observationStep("_tool_result_1"),
        // A prior final-answer attempt already happened (guard-rejected or not).
        actionStep("final-answer", { output: "first attempt" }),
      ] as any,
      scratchpad: new Map([["_tool_result_1", "full content"]]),
    } as any);
    expect(unconsumedEvidenceGuard(finalAnswerCall, state).pass).toBe(true);
  });

  it("does not fire once the storedKey was actually recall()'d", () => {
    const state = makeState({
      steps: [
        actionStep("http-get", { url: "https://example.com" }),
        observationStep("_tool_result_1"),
        actionStep("recall", { key: "_tool_result_1", full: true }),
      ] as any,
      scratchpad: new Map([["_tool_result_1", "full content"]]),
    } as any);
    expect(unconsumedEvidenceGuard(finalAnswerCall, state).pass).toBe(true);
  });

  it("ignores non-final-answer tool calls entirely", () => {
    const state = makeState({
      steps: [actionStep("http-get", {}), observationStep("_tool_result_1")] as any,
      scratchpad: new Map([["_tool_result_1", "full content"]]),
    } as any);
    expect(unconsumedEvidenceGuard(tc, state).pass).toBe(true);
  });
});
