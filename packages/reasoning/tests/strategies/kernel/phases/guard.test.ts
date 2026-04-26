import { describe, it, expect } from "bun:test";
import {
  blockedGuard,
  availableToolGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  defaultGuards,
  checkToolCall,
  type GuardOutcome,
} from "../../../../src/kernel/capabilities/act/guard.js";
import type { KernelState } from "../../../../src/kernel/state/kernel-state.js";

// ── Minimal state factory ─────────────────────────────────────────────────────

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "test-task",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "acting",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  } as KernelState;
}

function makeTc(name: string, args: Record<string, unknown> = {}, id = "call-1") {
  return { id, name, arguments: args };
}

const baseInput = { task: "do something", requiredTools: [] } as any;

// ── blockedGuard ──────────────────────────────────────────────────────────────

describe("blockedGuard", () => {
  it("passes when tool is not in input.blockedTools", () => {
    const result = blockedGuard(makeTc("web-search"), makeState(), { ...baseInput, blockedTools: [] });
    expect(result.pass).toBe(true);
  });

  it("blocks when tool is in input.blockedTools", () => {
    const result = blockedGuard(makeTc("web-search"), makeState(), { ...baseInput, blockedTools: ["web-search"] });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("web-search");
      expect(result.observation).toContain("BLOCKED");
    }
  });

  it("passes when blockedTools is undefined", () => {
    const result = blockedGuard(makeTc("web-search"), makeState(), { ...baseInput, blockedTools: undefined });
    expect(result.pass).toBe(true);
  });
});

describe("availableToolGuard", () => {
  it("passes when tool exists in availableToolSchemas", () => {
    const result = availableToolGuard(
      makeTc("web-search"),
      makeState(),
      {
        ...baseInput,
        availableToolSchemas: [{ name: "web-search" }],
      },
    );
    expect(result.pass).toBe(true);
  });

  it("blocks unknown tools and suggests available alternatives", () => {
    const result = availableToolGuard(
      makeTc("google:search"),
      makeState(),
      {
        ...baseInput,
        availableToolSchemas: [{ name: "web-search" }, { name: "http-get" }],
      },
    );
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("google:search");
      expect(result.observation).toContain("web-search");
    }
  });
});

// ── sideEffectGuard ───────────────────────────────────────────────────────────

describe("sideEffectGuard", () => {
  it("passes for a non-side-effect tool", () => {
    const result = sideEffectGuard(makeTc("web-search"), makeState(), baseInput);
    expect(result.pass).toBe(true);
  });

  it("passes for a side-effect tool with no prior successful call", () => {
    const result = sideEffectGuard(makeTc("send-email"), makeState(), baseInput);
    expect(result.pass).toBe(true);
  });

  it("blocks a side-effect tool that already ran successfully", () => {
    const priorAction = {
      id: "step-1", type: "action" as const, content: "send-email({})",
      metadata: { toolCall: { name: "send-email", arguments: {} } }, timestamp: new Date(),
    };
    const priorObs = {
      id: "step-2", type: "observation" as const, content: "Email sent",
      metadata: { observationResult: { toolName: "send-email", success: true, content: "Email sent" } },
      timestamp: new Date(),
    };
    const state = makeState({ steps: [priorAction, priorObs] as any });
    const result = sideEffectGuard(makeTc("send-email", { to: "other@example.com" }), state, baseInput);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("Side-effect tools must NOT be called twice");
    }
  });
});

// ── repetitionGuard ───────────────────────────────────────────────────────────

describe("repetitionGuard", () => {
  it("passes when tool called fewer than 2 times", () => {
    const action = {
      id: "s1", type: "action" as const, content: "web-search({})",
      metadata: { toolCall: { name: "web-search", arguments: {} } }, timestamp: new Date(),
    };
    const state = makeState({ steps: [action] as any });
    const result = repetitionGuard(makeTc("web-search"), state, baseInput);
    expect(result.pass).toBe(true);
  });

  it("blocks sequential-only tool (file-write) when called 2 or more times", () => {
    const makeAction = (id: string) => ({
      id, type: "action" as const, content: "file-write({})",
      metadata: { toolCall: { name: "file-write", arguments: {} } }, timestamp: new Date(),
    });
    const state = makeState({ steps: [makeAction("s1"), makeAction("s2")] as any });
    const result = repetitionGuard(makeTc("file-write"), state, baseInput);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("Stop repeating this tool");
    }
  });

  it("allows parallel-safe tool (web-search) to be called up to maxBatchSize times", () => {
    const makeAction = (id: string) => ({
      id, type: "action" as const, content: "web-search({})",
      metadata: { toolCall: { name: "web-search", arguments: {} } }, timestamp: new Date(),
    });
    const threeCallState = makeState({ steps: [makeAction("s1"), makeAction("s2"), makeAction("s3")] as any });
    const result = repetitionGuard(makeTc("web-search"), threeCallState, baseInput);
    // web-search is parallel-safe; threshold is maxBatchSize (4) not 2
    expect(result.pass).toBe(true);
  });

  it("passes for meta-tools regardless of call count", () => {
    const makeAction = (id: string) => ({
      id, type: "action" as const, content: "brief({})",
      metadata: { toolCall: { name: "brief", arguments: {} } }, timestamp: new Date(),
    });
    const state = makeState({ steps: [makeAction("s1"), makeAction("s2"), makeAction("s3")] as any });
    const result = repetitionGuard(makeTc("brief"), state, baseInput);
    expect(result.pass).toBe(true);
  });

  it("passes for spawn-agent when delegating multiple subtasks", () => {
    const makeAction = (id: string, task: string) => ({
      id,
      type: "action" as const,
      content: `spawn-agent(${task})`,
      metadata: { toolCall: { name: "spawn-agent", arguments: { task } } },
      timestamp: new Date(),
    });
    const state = makeState({
      steps: [makeAction("s1", "find XRP price"), makeAction("s2", "find XLM price")] as any,
    });
    const result = repetitionGuard(makeTc("spawn-agent", { task: "find ETH price" }), state, baseInput);
    expect(result.pass).toBe(true);
  });

  it("passes for named agent tools when delegating multiple subtasks", () => {
    const makeAction = (id: string, task: string) => ({
      id,
      type: "action" as const,
      content: `agent-researcher(${task})`,
      metadata: { toolCall: { name: "agent-researcher", arguments: { task } } },
      timestamp: new Date(),
    });
    const state = makeState({
      steps: [makeAction("s1", "find XRP price"), makeAction("s2", "find XLM price")] as any,
    });
    const result = repetitionGuard(makeTc("agent-researcher", { task: "find ETH price" }), state, baseInput);
    expect(result.pass).toBe(true);
  });
});

// ── checkToolCall (pipeline) ──────────────────────────────────────────────────

describe("checkToolCall", () => {
  it("passes when all guards pass", () => {
    const check = checkToolCall(defaultGuards);
    const result = check(
      makeTc("web-search"),
      makeState(),
      { ...baseInput, availableToolSchemas: [{ name: "web-search" }] },
    );
    expect(result.pass).toBe(true);
  });

  it("short-circuits on first failing guard", () => {
    let secondGuardCalled = false;
    const alwaysFail = (): GuardOutcome => ({ pass: false, observation: "first guard failed" });
    const trackSecond = (): GuardOutcome => { secondGuardCalled = true; return { pass: true }; };
    const check = checkToolCall([alwaysFail, trackSecond] as any);
    const result = check(makeTc("web-search"), makeState(), baseInput);
    expect(result.pass).toBe(false);
    expect(secondGuardCalled).toBe(false);
  });

  it("accepts a custom guard chain", () => {
    const customGuard = (tc: any): GuardOutcome =>
      tc.name === "forbidden" ? { pass: false, observation: "forbidden tool" } : { pass: true };
    const check = checkToolCall([customGuard]);
    expect(check(makeTc("web-search"), makeState(), baseInput).pass).toBe(true);
    expect(check(makeTc("forbidden"), makeState(), baseInput).pass).toBe(false);
  });
});

// ── repetitionGuard — requiredToolQuantities ──────────────────────────────────

describe("repetitionGuard — requiredToolQuantities threshold", () => {
  function makeActions(name: string, count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      type: "action" as const,
      content: `${name}({})`,
      metadata: { toolCall: { name, arguments: {} } },
      timestamp: new Date(),
    }));
  }

  it("allows calls up to minCalls when requiredToolQuantities specifies 4", () => {
    const inputWith4 = {
      ...baseInput,
      requiredToolQuantities: { "http-get": 4 },
      nextMovesPlanning: { enabled: true, maxBatchSize: 4, allowParallelBatching: true },
    };
    // 3 prior calls → should still pass (3 < 4)
    const state = makeState({ steps: makeActions("http-get", 3) as any });
    expect(repetitionGuard(makeTc("http-get"), state, inputWith4).pass).toBe(true);
  });

  it("blocks when prior calls reach minCalls from requiredToolQuantities", () => {
    const inputWith4 = {
      ...baseInput,
      requiredToolQuantities: { "http-get": 4 },
      nextMovesPlanning: { enabled: true, maxBatchSize: 4, allowParallelBatching: true },
    };
    // 4 prior calls → block the 5th
    const state = makeState({ steps: makeActions("http-get", 4) as any });
    const result = repetitionGuard(makeTc("http-get"), state, inputWith4);
    expect(result.pass).toBe(false);
  });

  it("missing-tools hint shows N/M call progress when requiredToolQuantities is set", () => {
    const inputWith4 = {
      ...baseInput,
      requiredTools: ["http-get"],
      requiredToolQuantities: { "http-get": 4 },
      nextMovesPlanning: { enabled: true, maxBatchSize: 4, allowParallelBatching: true },
    };
    // 2 of 4 calls done — guard on a file-write (different tool) triggers the nudge path
    const state = makeState({ steps: makeActions("http-get", 2) as any });
    // Trigger repetitionGuard on file-write (which has 5 prior calls, exceeds threshold 2)
    const fileWriteState = makeState({ steps: makeActions("file-write", 5) as any });
    const result = repetitionGuard(makeTc("file-write"), fileWriteState, inputWith4);
    if (!result.pass) {
      // The observation should mention http-get with count progress
      expect(result.observation).toContain("http-get");
      expect(result.observation).toMatch(/\d+\/\d+/); // e.g. "0/4" or "2/4"
    }
  });

  it("low minCalls does NOT shrink the parallel-safe ceiling (floor vs ceiling bug)", () => {
    // Regression: classifier returns minCalls:1 for web-search (a single-query task).
    // The agent then calls web-search again for a follow-up query.
    // The guard must NOT block because web-search is parallel-safe (ceiling = maxBatchSize=4).
    const inputWithLowMinCalls = {
      ...baseInput,
      requiredToolQuantities: { "web-search": 1 },
      nextMovesPlanning: { enabled: true, maxBatchSize: 4, allowParallelBatching: true },
    };
    // 1 prior call — the classifier says minCalls=1 but the ceiling should still be maxBatchSize=4
    const state = makeState({ steps: makeActions("web-search", 1) as any });
    expect(repetitionGuard(makeTc("web-search"), state, inputWithLowMinCalls).pass).toBe(true);

    // 3 prior calls — still below the parallel-safe ceiling of 4
    const state3 = makeState({ steps: makeActions("web-search", 3) as any });
    expect(repetitionGuard(makeTc("web-search"), state3, inputWithLowMinCalls).pass).toBe(true);

    // 4 prior calls — now we hit the ceiling
    const state4 = makeState({ steps: makeActions("web-search", 4) as any });
    expect(repetitionGuard(makeTc("web-search"), state4, inputWithLowMinCalls).pass).toBe(false);
  });
});
