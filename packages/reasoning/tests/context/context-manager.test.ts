// Run: bun test packages/reasoning/tests/context/context-manager.test.ts --timeout 15000
//
// TDD: ALL tests in this file fail until context-manager.ts is implemented.
// The import itself will fail (file does not exist yet).
import { describe, it, expect } from "bun:test";
import {
  ContextManager,
  type GuidanceContext,
} from "../../src/context/context-manager.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";

// ── Test helpers ─────────────────────────────────────────────────────────────

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

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    task: "Find the current BTC price in USD",
    availableToolSchemas: [
      { name: "web-search", description: "Search the web", parameters: [] },
      { name: "final-answer", description: "Deliver the answer", parameters: [] },
    ],
    requiredTools: ["web-search"],
    ...overrides,
  } as any;
}

const noGuidance: GuidanceContext = {
  requiredToolsPending: [],
  loopDetected: false,
};

// ── ContextManager.build — system prompt shape ────────────────────────────────

describe("ContextManager.build — systemPrompt", () => {
  it("includes the task in the system prompt", () => {
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
    );
    expect(systemPrompt).toContain("BTC price");
  }, 15000);

  it("includes available tools in the system prompt", () => {
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
    );
    expect(systemPrompt).toContain("web-search");
  }, 15000);

  it("includes environment context (Date) in the system prompt", () => {
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
    );
    expect(systemPrompt).toMatch(/Date:|Environment:/);
  }, 15000);

  it("includes Progress section showing tool usage", () => {
    const stateWithTools = makeState({ toolsUsed: new Set(["web-search"]) });
    const { systemPrompt } = ContextManager.build(
      stateWithTools,
      makeInput(),
      CONTEXT_PROFILES.mid,
      noGuidance,
    );
    expect(systemPrompt).toMatch(/Progress:|web-search.*called|called.*web-search/i);
  }, 15000);

  it("includes Guidance section when required tools are pending", () => {
    const guidance: GuidanceContext = {
      requiredToolsPending: ["web-search"],
      loopDetected: false,
    };
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.local,
      guidance,
    );
    expect(systemPrompt).toMatch(/Guidance:|web-search.*required|REQUIRED/i);
  }, 15000);

  it("includes loop-detected guidance when loop is flagged", () => {
    const guidance: GuidanceContext = {
      requiredToolsPending: [],
      loopDetected: true,
    };
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.local,
      guidance,
    );
    expect(systemPrompt).toMatch(/loop|repeated|different approach/i);
  }, 15000);

  it("includes ICS guidance when provided", () => {
    const guidance: GuidanceContext = {
      requiredToolsPending: [],
      loopDetected: false,
      icsGuidance: "Focus on synthesis now — all data collected.",
    };
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.mid,
      guidance,
    );
    expect(systemPrompt).toContain("synthesis");
  }, 15000);

  it("does not include Guidance section when nothing to report", () => {
    const { systemPrompt } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.mid,
      noGuidance,
    );
    // No guidance signals → no Guidance section needed
    expect(systemPrompt).not.toMatch(/^Guidance:/m);
  }, 15000);

  it("is deterministic — same inputs produce same system prompt", () => {
    const state = makeState();
    const input = makeInput();
    const profile = CONTEXT_PROFILES.local;
    const r1 = ContextManager.build(state, input, profile, noGuidance);
    const r2 = ContextManager.build(state, input, profile, noGuidance);
    // Allow different timestamps (environment context) but structure is stable
    expect(r1.systemPrompt.length).toBe(r2.systemPrompt.length);
  }, 15000);
});

// ── ContextManager.build — curated messages ───────────────────────────────────

describe("ContextManager.build — messages", () => {
  it("returns an empty message array when no conversation history exists", () => {
    const { messages } = ContextManager.build(
      makeState(),
      makeInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
    );
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(0);
  }, 15000);

  it("returns messages in chronological order (oldest first)", () => {
    const userMsg = { role: "user" as const, content: "test task" };
    const assistantMsg = { role: "assistant" as const, content: "I will search." };
    const stateWithMessages = makeState({
      messages: [userMsg, assistantMsg],
    });
    const { messages } = ContextManager.build(
      stateWithMessages,
      makeInput(),
      CONTEXT_PROFILES.mid,
      noGuidance,
    );
    // Last message should be the most recent
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg?.role).toBe("assistant");
  }, 15000);

  it("never contains [Auto-forwarded:] USER message injections", () => {
    const stateWithScratchpad = makeState({
      scratchpad: new Map([["_result_1", "some stored data"]]),
      messages: [
        { role: "user", content: "task" },
        {
          role: "assistant",
          content: "searching",
          toolCalls: [{ id: "call-1", name: "web-search", arguments: {} }],
        } as any,
        {
          role: "tool_result",
          toolCallId: "call-1",
          toolName: "web-search",
          content: "[Compacted — use recall]",
        } as any,
      ],
      iteration: 1,
    });
    const { messages } = ContextManager.build(
      stateWithScratchpad,
      makeInput(),
      CONTEXT_PROFILES.local,
      noGuidance,
    );
    const hasAutoForward = messages.some(
      (m) => typeof m.content === "string" && m.content.includes("[Auto-forwarded:"),
    );
    expect(hasAutoForward).toBe(false);
  }, 15000);

  it("does not duplicate tool results between messages and system prompt", () => {
    const toolResultContent = "BTC price is $45,000 USD as of today";
    const stateWithResult = makeState({
      messages: [
        { role: "user", content: "task" },
        {
          role: "assistant",
          content: "let me search",
          toolCalls: [{ id: "tc1", name: "web-search", arguments: {} }],
        } as any,
        {
          role: "tool_result",
          toolCallId: "tc1",
          toolName: "web-search",
          content: toolResultContent,
        } as any,
      ],
    });
    const { systemPrompt, messages } = ContextManager.build(
      stateWithResult,
      makeInput(),
      CONTEXT_PROFILES.mid,
      noGuidance,
    );
    // The tool result should be in messages, NOT duplicated in the system prompt
    expect(systemPrompt).not.toContain(toolResultContent);
    const inMessages = messages.some(
      (m) => typeof m.content === "string" && m.content.includes(toolResultContent),
    );
    expect(inMessages).toBe(true);
  }, 15000);
});
