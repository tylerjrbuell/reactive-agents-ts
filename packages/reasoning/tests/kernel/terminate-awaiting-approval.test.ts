// Run: bun test packages/reasoning/tests/kernel/terminate-awaiting-approval.test.ts
//
// Durable HITL (Phase D): an approval pause is a NON-FAILURE terminal reason.
// The terminal PostCondition gate (terminate.ts) demotes a forced termination to
// status:"failed" when a stored condition is unmet — but a run paused for human
// approval has INTENTIONALLY not met its post-conditions yet and must NOT be
// mislabeled as a dead/failed run. This proves reason:"awaiting-approval" passes
// the gate through to a clean terminal transition even with unmet conditions.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { terminate } from "../../src/kernel/loop/terminate.js";
import { sentinelDeliverable } from "@reactive-agents/core";
import {
  artifactProduced,
  toolCalled,
} from "../../src/kernel/capabilities/verify/post-conditions.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";

const PRIOR = process.env.RA_POST_CONDITIONS;
beforeEach(() => { process.env.RA_POST_CONDITIONS = "1"; });
afterEach(() => {
  if (PRIOR === undefined) delete process.env.RA_POST_CONDITIONS;
  else process.env.RA_POST_CONDITIONS = PRIOR;
});

const unmetConditions = [
  artifactProduced("./commits.md"),
  toolCalled("file-write"),
] as const;

function baseState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 2,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 2,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    pendingGuidance: undefined,
    consecutiveLowDeltaCount: 0,
    readyToAnswerNudgeCount: 0,
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
    ...overrides,
  } as KernelState;
}

describe("terminate() — awaiting-approval is non-failure", () => {
  it("does NOT demote to failed despite unmet post-conditions", () => {
    const state = baseState({
      meta: {
        postConditions: [...unmetConditions],
        awaitingApprovalFor: { gateId: "g1", toolName: "shell-execution", args: { cmd: "ls" } },
      },
    });
    const next = terminate(state, {
      reason: "awaiting-approval",
      deliverable: sentinelDeliverable("awaiting human approval"),
    });
    expect(next.status).not.toBe("failed");
    expect(next.status).toBe("done");
    expect(next.meta.terminatedBy).toBe("awaiting-approval");
    expect(next.meta.awaitingApprovalFor?.gateId).toBe("g1");
  });

  it("a different forced reason with the same unmet conditions still fails (control)", () => {
    const state = baseState({ meta: { postConditions: [...unmetConditions] } });
    const next = terminate(state, {
      reason: "harness_deliverable",
      deliverable: sentinelDeliverable("forced"),
    });
    expect(next.status).toBe("failed");
  });
});
