// Run: bun test packages/reasoning/tests/kernel/capabilities/decide/post-condition-gate.test.ts --timeout 15000
//
// Arbitrator PostCondition gate — the state-grounded success authority wired at
// the verdict seam. DEFAULT-ON (opt-out via RA_POST_CONDITIONS=0): a would-be
// exit-success verdict is demoted to a "post-condition-steer" escalation when a
// derived post-condition is unmet (e.g. the required ./commits.md was never
// written). Legacy prose-only success is reachable via RA_POST_CONDITIONS=0.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  arbitrate,
  applyTermination,
  type ArbitrationContext,
} from "../../../../src/kernel/capabilities/decide/arbitrator.js";
import type { KernelState } from "../../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../../src/types/index.js";
import type { ObservationResult } from "../../../../src/types/observation.js";

const PRIOR = process.env.RA_POST_CONDITIONS;
beforeEach(() => { delete process.env.RA_POST_CONDITIONS; });
afterEach(() => {
  if (PRIOR === undefined) delete process.env.RA_POST_CONDITIONS;
  else process.env.RA_POST_CONDITIONS = PRIOR;
});

function writeObs(success: boolean, id: string): ReasoningStep[] {
  return [
    {
      id: `act-${id}` as ReasoningStep["id"],
      type: "action",
      content: "file-write(...)",
      timestamp: new Date(),
      metadata: { toolCall: { id, name: "file-write", arguments: { path: "./commits.md", content: "x" } } },
    },
    {
      id: `obs-${id}` as ReasoningStep["id"],
      type: "observation",
      content: success ? "ok" : "err",
      timestamp: new Date(),
      metadata: {
        toolCallId: id,
        observationResult: {
          success,
          toolName: "file-write",
          displayText: success ? "ok" : "err",
          category: success ? "file-write" : "error",
          resultKind: success ? "side-effect" : "error",
          preserveOnCompaction: true,
          trustLevel: "untrusted",
        } as ObservationResult,
      },
    },
  ];
}

const taskWithDeliverable =
  "Fetch the commits and create a markdown file (./commits.md) summarizing them.";

function ctxWith(steps: readonly ReasoningStep[]): ArbitrationContext {
  return {
    iteration: 2,
    task: taskWithDeliverable,
    steps,
    toolsUsed: new Set(steps.filter((s) => s.type === "observation").map(() => "file-write")),
    requiredTools: ["file-write"],
  };
}

const baseState: KernelState = {
  taskId: "t",
  strategy: "reactive",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set(),
  scratchpad: new Map(),
  iteration: 0,
  tokens: 0,
  cost: 0,
  status: "thinking",
  output: null,
  error: null,
  llmCalls: 0,
  meta: {},
  controllerDecisionLog: [],
  messages: [],
  pendingGuidance: undefined,
  consecutiveLowDeltaCount: 0,
  readyToAnswerNudgeCount: 0,
  lastMetaToolCall: undefined,
  consecutiveMetaToolCount: 0,
} as KernelState;

describe("PostCondition gate — flag ON", () => {
  beforeEach(() => { process.env.RA_POST_CONDITIONS = "1"; });

  it("demotes exit-success to escalate when the required artifact was never produced", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "Here is the summary of commits." },
      ctxWith([]), // no file-write happened
    );
    expect(v.action).not.toBe("exit-success");
    expect(v.action).toBe("escalate");
    if (v.action === "escalate") {
      expect(v.nextStrategy).toBe("post-condition-steer");
      expect(v.reason).toContain("./commits.md");
    }
  }, 15000);

  it("allows exit-success once the artifact IS produced (state-grounded)", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "Done." },
      ctxWith(writeObs(true, "tc1")),
    );
    expect(v.action).toBe("exit-success");
  }, 15000);

  it("steer escalation keeps status thinking + sets errorRecovery, no escalateTo", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "summary" },
      ctxWith([]),
    );
    const next = applyTermination(baseState, v);
    expect(next.status).toBe("thinking");
    expect(next.pendingGuidance?.errorRecovery).toContain("./commits.md");
    expect((next.meta as Record<string, unknown>).escalateTo).toBeUndefined();
    expect((next.meta as Record<string, unknown>).synthesisRetryCount).toBeUndefined();
  }, 15000);

  it("empty derived conditions -> prose verdict stands (fast-path, no required tools)", () => {
    const v = arbitrate(
      { kind: "fast-path-completed", output: "Recursion is a function calling itself." },
      { iteration: 1, task: "Summarize recursion.", steps: [], toolsUsed: new Set(), requiredTools: [] },
    );
    expect(v.action).toBe("exit-success");
  }, 15000);
});

describe("PostCondition gate — DEFAULT-ON (env unset → gate ACTIVE)", () => {
  // No env set here: the top-level beforeEach deletes RA_POST_CONDITIONS, so this
  // exercises the unset → enabled contract directly.
  it("demotes exit-success on unmet conditions with the flag UNSET (default-on)", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "summary" },
      ctxWith([]),
    );
    expect(v.action).toBe("escalate");
    if (v.action === "escalate") {
      expect(v.nextStrategy).toBe("post-condition-steer");
    }
  }, 15000);
});

describe("PostCondition gate — opt-out (RA_POST_CONDITIONS=0, legacy prose-only)", () => {
  beforeEach(() => { process.env.RA_POST_CONDITIONS = "0"; });

  it("does NOT demote exit-success even with unmet conditions", () => {
    const v = arbitrate(
      { kind: "agent-final-answer", via: "tool", output: "summary" },
      ctxWith([]),
    );
    expect(v.action).toBe("exit-success");
  }, 15000);
});
