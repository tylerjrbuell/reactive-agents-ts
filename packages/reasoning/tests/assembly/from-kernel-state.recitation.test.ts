// Run: bun test packages/reasoning/tests/assembly/from-kernel-state.recitation.test.ts --timeout 15000
//
// WS-4 progress recitation — fromKernelState emits a `goal_state` event computed
// FRESH each turn from verify(state.meta.postConditions, state.steps). This is
// the PRODUCER that makes the previously-dead `goal_state` event live: the
// systemPromptStage consumer renders `remaining[]` so the model re-orients on
// what still has to happen every turn (Manus recitation pattern). When all
// conditions are met (or none derived) NO goal_state is emitted — additive,
// byte-identical to prior behavior on satisfied/no-condition runs.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { fromKernelState, recitationEnabled } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import {
  toolCalled,
  artifactProduced,
} from "../../src/kernel/capabilities/verify/post-conditions.js";
import type { ReasoningStep } from "../../src/types/index.js";
import type { ObservationResult } from "../../src/types/observation.js";

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
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [{ role: "user", content: "Write the commit log to ./commits.md" }],
    ...overrides,
  } as KernelState;
}

let n = 0;
function successObs(toolName: string): ReasoningStep {
  return {
    id: `obs-${n++}` as ReasoningStep["id"],
    type: "observation",
    content: "ok",
    timestamp: new Date(),
    metadata: {
      observationResult: {
        success: true,
        toolName,
        displayText: "ok",
        category: "data",
        resultKind: "data",
        preserveOnCompaction: true,
        trustLevel: "untrusted",
      } as ObservationResult,
    },
  };
}

const persona = { system: "You are a helpful assistant." };
const tools = { schemas: [] as readonly unknown[] };
const profile = CONTEXT_PROFILES.mid;

// Recitation is OPT-IN (RA_RECITE=1) until the cross-tier ablation proves lift.
// These behavior tests run with the gate forced ON; a separate block asserts
// the default-off gate.
const ORIGINAL_RECITE = process.env.RA_RECITE;
beforeAll(() => {
  process.env.RA_RECITE = "1";
});
afterAll(() => {
  if (ORIGINAL_RECITE === undefined) delete process.env.RA_RECITE;
  else process.env.RA_RECITE = ORIGINAL_RECITE;
});

describe("recitationEnabled — gate", () => {
  it("is OFF by default (opt-in until ablation-proven)", () => {
    expect(recitationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  }, 15000);
  it("is ON only with RA_RECITE=1", () => {
    expect(recitationEnabled({ RA_RECITE: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(recitationEnabled({ RA_RECITE: "0" } as NodeJS.ProcessEnv)).toBe(false);
  }, 15000);
});

describe("fromKernelState — WS-4 goal_state recitation producer", () => {
  it("emits NO goal_state when the gate is OFF, even with unmet conditions", () => {
    const prev = process.env.RA_RECITE;
    delete process.env.RA_RECITE;
    try {
      const state = makeState({
        meta: { postConditions: [toolCalled("file-write")] },
        steps: [],
      });
      expect(fromKernelState(state, profile, persona, tools).log.byKind("goal_state").length).toBe(0);
    } finally {
      if (prev !== undefined) process.env.RA_RECITE = prev;
    }
  }, 15000);

  it("emits a goal_state event listing UNMET conditions when none are satisfied", () => {
    const state = makeState({
      meta: { postConditions: [toolCalled("file-write"), artifactProduced("./commits.md")] },
      steps: [], // nothing done yet
    });
    const input = fromKernelState(state, profile, persona, tools);
    const gs = input.log.byKind("goal_state");
    expect(gs.length).toBe(1);
    expect(gs[0].remaining).toEqual([
      "call the `file-write` tool",
      "write the file ./commits.md",
    ]);
  }, 15000);

  it("lists only the STILL-unmet conditions as progress is made", () => {
    const state = makeState({
      meta: { postConditions: [toolCalled("file-write"), artifactProduced("./commits.md")] },
      steps: [successObs("file-write")], // tool called, artifact not yet linked
    });
    const input = fromKernelState(state, profile, persona, tools);
    const gs = input.log.byKind("goal_state");
    expect(gs.length).toBe(1);
    // file-write tool IS now called → drops out; artifact still pending.
    expect(gs[0].remaining).toEqual(["write the file ./commits.md"]);
  }, 15000);

  it("emits NO goal_state when every condition is met", () => {
    const state = makeState({
      meta: { postConditions: [toolCalled("file-write")] },
      steps: [successObs("file-write")],
    });
    const input = fromKernelState(state, profile, persona, tools);
    expect(input.log.byKind("goal_state").length).toBe(0);
  }, 15000);

  it("emits NO goal_state when no postConditions are derived (backward-compat)", () => {
    const state = makeState({ meta: {} });
    const input = fromKernelState(state, profile, persona, tools);
    expect(input.log.byKind("goal_state").length).toBe(0);
  }, 15000);

  it("END-TO-END: producer→consumer — the recited remaining surfaces in the assembled system prompt", () => {
    const state = makeState({
      meta: { postConditions: [toolCalled("file-write"), artifactProduced("./commits.md")] },
      steps: [],
    });
    const { request } = project(fromKernelState(state, profile, persona, tools));
    expect(request.systemPrompt).toContain("Remaining steps:");
    expect(request.systemPrompt).toContain("call the `file-write` tool");
    expect(request.systemPrompt).toContain("write the file ./commits.md");
  }, 15000);

  it("END-TO-END: no recitation block when all conditions met (additive no-op)", () => {
    const state = makeState({
      meta: { postConditions: [toolCalled("file-write")] },
      steps: [successObs("file-write")],
    });
    const { request } = project(fromKernelState(state, profile, persona, tools));
    expect(request.systemPrompt).not.toContain("Remaining steps:");
  }, 15000);

  it("OutputContains is satisfied from state.output (assembled deliverable)", () => {
    const state = makeState({
      meta: { postConditions: [artifactProduced("./commits.md")] },
      steps: [],
      output: null,
    });
    // artifact unmet → recited
    expect(
      fromKernelState(state, profile, persona, tools).log.byKind("goal_state")[0]
        ?.remaining,
    ).toEqual(["write the file ./commits.md"]);
  }, 15000);
});
