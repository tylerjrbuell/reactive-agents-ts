import { describe, it, expect } from "bun:test";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

// ── Minimal KernelState fixture factory ──────────────────────────────────────
// Pattern mirrors guard.test.ts — structural cast for optional fields.

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
    messages: [],
    ...overrides,
  } as KernelState;
}

// ── Fixture data ──────────────────────────────────────────────────────────────

const COMMITS = [{ sha: "s0", commit: { message: "m0" } }];
const STORED_KEY = "_tool_result_1";

// KernelState that resembles a run with one list_commits call
const stateWithToolCall = makeState({
  messages: [
    { role: "user", content: "List the most recent commit" },
    {
      role: "assistant",
      content: "I will call list_commits.",
      toolCalls: [
        { id: "c1", name: "list_commits", arguments: { limit: 1 } },
      ],
    },
    {
      role: "tool_result",
      toolCallId: "c1",
      toolName: "list_commits",
      content: "[STORED:_tool_result_1]",
      storedKey: STORED_KEY,
    },
  ],
  scratchpad: new Map([[STORED_KEY, JSON.stringify(COMMITS)]]),
});

const persona = { system: "You are a helpful assistant." };
const tools = { schemas: [] as readonly unknown[] };
const profile = CONTEXT_PROFILES.mid;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fromKernelState — KernelState → AssemblyInput adapter", () => {
  it("produces exactly one tool_result event with ref === storedKey", () => {
    const input = fromKernelState(stateWithToolCall, profile, persona, tools);
    const trEvents = input.log.byKind("tool_result");
    expect(trEvents.length).toBe(1);
    expect(trEvents[0].ref).toBe(STORED_KEY);
    expect(trEvents[0].callId).toBe("c1");
  });

  it("store.get(storedKey) resolves to the parsed scratchpad value", () => {
    const input = fromKernelState(stateWithToolCall, profile, persona, tools);
    const stored = input.store.get(STORED_KEY);
    expect(stored).toBeDefined();
    expect(stored?.value).toEqual(COMMITS);
  });

  it("produces at least one goal event from the first user message", () => {
    const input = fromKernelState(stateWithToolCall, profile, persona, tools);
    expect(input.log.byKind("goal").length).toBeGreaterThanOrEqual(1);
    expect(input.log.byKind("goal")[0].text).toBe("List the most recent commit");
  });

  it("capability.window is a positive number derived from the profile", () => {
    const input = fromKernelState(stateWithToolCall, profile, persona, tools);
    expect(input.capability.window).toBeGreaterThan(0);
    expect(input.capability.window).toBe(profile.maxTokens);
  });

  it("produces a tool_called event for each assistant toolCall", () => {
    const input = fromKernelState(stateWithToolCall, profile, persona, tools);
    const tcEvents = input.log.byKind("tool_called");
    expect(tcEvents.length).toBe(1);
    expect(tcEvents[0].tool).toBe("list_commits");
    expect(tcEvents[0].callId).toBe("c1");
    expect(tcEvents[0].args).toEqual({ limit: 1 });
  });

  it("handles a state with no messages (no goal, no events)", () => {
    const emptyState = makeState();
    const input = fromKernelState(emptyState, profile, persona, tools);
    expect(input.log.byKind("goal").length).toBe(0);
    expect(input.log.byKind("tool_result").length).toBe(0);
  });

  it("handles inline tool_result with no storedKey — mints a ref and stores content", () => {
    const inlineState = makeState({
      messages: [
        { role: "user", content: "ping" },
        {
          role: "assistant",
          content: "calling ping",
          toolCalls: [{ id: "c2", name: "ping", arguments: {} }],
        },
        {
          role: "tool_result",
          toolCallId: "c2",
          toolName: "ping",
          content: "pong",
        },
      ],
    });
    const input = fromKernelState(inlineState, profile, persona, tools);
    const trEvents = input.log.byKind("tool_result");
    expect(trEvents.length).toBe(1);
    const ref = trEvents[0].ref;
    expect(input.store.get(ref)).toBeDefined();
    expect(input.store.get(ref)?.value).toBe("pong");
  });

  it("invalid JSON in scratchpad falls back to raw string value", () => {
    const badJsonState = makeState({
      messages: [
        { role: "user", content: "task" },
        {
          role: "tool_result",
          toolCallId: "c3",
          toolName: "tool",
          content: "[STORED:_tool_result_2]",
          storedKey: "_tool_result_2",
        },
      ],
      scratchpad: new Map([["_tool_result_2", "not-valid-json{"]]),
    });
    const input = fromKernelState(badJsonState, profile, persona, tools);
    expect(input.store.get("_tool_result_2")?.value).toBe("not-valid-json{");
  });
});
