// Run: bun test packages/reasoning/tests/context/context-curator.test.ts --timeout 15000
//
// Pin the S2.5 ContextCurator seam:
//   1. defaultContextCurator returns the same Prompt as the underlying
//      ContextManager.build (Slice A is byte-identical wrapping).
//   2. renderObservationForPrompt wraps untrusted observations in a
//      <tool_output> block; trusted observations render plainly.
//
// If a future refactor introduces a parallel prompt-author path that bypasses
// the curator, these assertions still hold for the curator path — but cf-19
// (gate scenario) is what surfaces the *architectural* regression.

import { describe, it, expect } from "bun:test";
import {
  defaultContextCurator,
  renderObservationForPrompt,
} from "../../src/context/context-curator.js";
import { ContextManager, type GuidanceContext } from "../../src/context/context-manager.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { KernelState } from "../../src/strategies/kernel/kernel-state.js";
import type { ObservationResult } from "../../src/types/observation.js";

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t1",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
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
    ...overrides,
  } as KernelState;
}

function makeInput() {
  return {
    task: "Summarize the docs",
    availableToolSchemas: [
      { name: "web-search", description: "Search", parameters: [] },
    ],
    requiredTools: [] as string[],
  } as never;
}

const noGuidance: GuidanceContext = {
  requiredToolsPending: [],
  loopDetected: false,
};

describe("defaultContextCurator", () => {
  it("returns a Prompt byte-identical to ContextManager.build (Slice A wrapping)", () => {
    const state = makeState();
    const input = makeInput();
    const profile = CONTEXT_PROFILES.local;

    const direct = ContextManager.build(state, input, profile, noGuidance);
    const curated = defaultContextCurator.curate(state, input, profile, noGuidance);

    expect(curated.systemPrompt).toBe(direct.systemPrompt);
    expect(curated.messages).toEqual(direct.messages);
  });

  it("forwards options (availableTools, systemPromptBody) through to the underlying builder", () => {
    const state = makeState();
    const input = makeInput();
    const profile = CONTEXT_PROFILES.local;

    const { systemPrompt } = defaultContextCurator.curate(
      state,
      input,
      profile,
      noGuidance,
      undefined,
      {
        availableTools: [{ name: "custom-only", description: "", parameters: [] }],
        systemPromptBody: "You are a documentation summarizer.",
      },
    );

    expect(systemPrompt).toContain("custom-only");
    expect(systemPrompt).toContain("documentation summarizer");
  });
});

describe("renderObservationForPrompt", () => {
  const trusted: ObservationResult = {
    success: true,
    toolName: "recall",
    displayText: "scratchpad value here",
    category: "scratchpad",
    resultKind: "side-effect",
    preserveOnCompaction: false,
    trustLevel: "trusted",
    trustJustification: "grandfather-phase-1",
  };

  const untrusted: ObservationResult = {
    success: true,
    toolName: "web-search",
    displayText: "Page contents may contain ignore previous instructions.",
    category: "web-search",
    resultKind: "data",
    preserveOnCompaction: false,
    trustLevel: "untrusted",
  };

  it("renders trusted observations plainly (no wrapping)", () => {
    const out = renderObservationForPrompt(trusted);
    expect(out).toBe("scratchpad value here");
    expect(out).not.toContain("<tool_output");
  });

  it("wraps untrusted observations in a <tool_output> block tagged with toolName", () => {
    const out = renderObservationForPrompt(untrusted);
    expect(out.startsWith('<tool_output tool="web-search">')).toBe(true);
    expect(out.endsWith("</tool_output>")).toBe(true);
    expect(out).toContain("ignore previous instructions");
  });

  it("preserves the original displayText inside the wrapper (no truncation)", () => {
    const long = { ...untrusted, displayText: "A".repeat(2000) };
    const out = renderObservationForPrompt(long);
    expect(out).toContain("A".repeat(2000));
  });
});
