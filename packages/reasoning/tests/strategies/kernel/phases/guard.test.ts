import { describe, it, expect } from "bun:test";
import {
  blockedGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  defaultGuards,
  checkToolCall,
  type GuardOutcome,
} from "../../../../src/strategies/kernel/phases/guard.js";
import type { KernelState } from "../../../../src/strategies/kernel/kernel-state.js";

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

  it("blocks when tool has been called 2 or more times", () => {
    const makeAction = (id: string) => ({
      id, type: "action" as const, content: "web-search({})",
      metadata: { toolCall: { name: "web-search", arguments: {} } }, timestamp: new Date(),
    });
    const state = makeState({ steps: [makeAction("s1"), makeAction("s2")] as any });
    const result = repetitionGuard(makeTc("web-search"), state, baseInput);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("Stop repeating this tool");
    }
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
});

// ── checkToolCall (pipeline) ──────────────────────────────────────────────────

describe("checkToolCall", () => {
  it("passes when all guards pass", () => {
    const check = checkToolCall(defaultGuards);
    const result = check(makeTc("web-search"), makeState(), baseInput);
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
