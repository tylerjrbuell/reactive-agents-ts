// Run: bun test packages/reasoning/tests/context/curator-compression-recommendation.test.ts
//
// Issue #119 / North Star v5.0 §4.3 — Curator consumes the advisory
// CompressionRecommendation set by the reactive-observer.
//
// Invariants:
//   1. No recommendation → baseline behavior unchanged
//   2. Fresh recommendation → effective budget clamped
//   3. state.messages never mutated by the curator (single-author)
//   4. Stale recommendation (>1 iteration old) → ignored

import { describe, it, expect } from "bun:test";
import { buildConversationMessages } from "../../src/kernel/capabilities/attend/context-utils.js";
import type {
  KernelState,
  KernelInput,
  KernelMessage,
} from "../../src/kernel/state/kernel-state.js";
import type { ContextProfile } from "../../src/context/context-profile.js";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";

// Minimal stub adapter (no taskFraming so the curator emits the thread as-is).
const stubAdapter: ProviderAdapter = {
  name: "stub",
} as unknown as ProviderAdapter;

function makeBigThread(turns: number, sizePerMsg: number = 800): KernelMessage[] {
  const BIG = "x".repeat(sizePerMsg);
  const out: KernelMessage[] = [{ role: "user", content: "original task" }];
  for (let i = 0; i < turns; i++) {
    out.push({
      role: "assistant",
      content: "calling",
      toolCalls: [{ id: `tc${i}`, name: "web-search", arguments: {} }],
    });
    out.push({
      role: "tool_result",
      toolCallId: `tc${i}`,
      toolName: "web-search",
      content: BIG,
    });
  }
  return out;
}

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "t",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 5,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  };
}

const baseProfile: ContextProfile = {
  tier: "local",
  maxTokens: 100_000, // large — sliding window will not fire from profile alone
} as ContextProfile;

const baseInput: KernelInput = { task: "original task" };

describe("buildConversationMessages — Issue #119 CompressionRecommendation consumption", () => {
  it("INVARIANT 1: without a recommendation, behavior is identical to the pre-#119 baseline", () => {
    const messages = makeBigThread(5, 200); // under profile budget
    const state = makeState({ messages });
    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);

    // With a large profile budget and no recommendation, every message is
    // forwarded as-is (modulo provider mapping).
    expect(out.length).toBe(messages.length);
    expect(out[0]?.role).toBe("user");
    // Sanity: first user message preserved (the task).
    expect((out[0] as { role: string; content: string }).content).toContain("original task");
  });

  it("INVARIANT 2: fresh recommendation clamps the effective budget", () => {
    const messages = makeBigThread(6, 1000);
    const state = makeState({
      iteration: 5,
      messages,
      meta: {
        pendingCompressionRecommendation: {
          targetTokens: 500, // tiny — forces sliding-window compaction
          reason: "context-pressure",
          recommendedAtIteration: 5,
        },
      },
    });

    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);

    // Compaction must have fired — output is fewer messages than the input
    // thread because applyMessageWindowWithCompact replaced older turns with
    // a `[Prior: ...]` summary.
    expect(out.length).toBeLessThan(messages.length);
    // First message must still be the original task (API cache prefix).
    expect(out[0]?.role).toBe("user");
  });

  it("INVARIANT 2b: stale recommendation (older than 1 iteration) is ignored", () => {
    const messages = makeBigThread(3, 200);
    const state = makeState({
      iteration: 10,
      messages,
      meta: {
        pendingCompressionRecommendation: {
          targetTokens: 500,
          reason: "context-pressure",
          recommendedAtIteration: 3, // 10 - 3 = 7 > 1 — stale
        },
      },
    });

    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);
    // Stale recommendation ignored — all messages forwarded.
    expect(out.length).toBe(messages.length);
  });

  it("INVARIANT 3: state.messages is unchanged after curator render", () => {
    const messages = makeBigThread(6, 1000);
    const state = makeState({
      iteration: 5,
      messages,
      meta: {
        pendingCompressionRecommendation: {
          targetTokens: 500,
          reason: "context-pressure",
          recommendedAtIteration: 5,
        },
      },
    });
    const beforeRef = state.messages;
    const beforeLength = state.messages.length;

    buildConversationMessages(state, baseInput, baseProfile, stubAdapter);

    // Canonical thread untouched — same reference, same length. Curator
    // authors the rendered Prompt.messages but never mutates state.messages.
    expect(state.messages).toBe(beforeRef);
    expect(state.messages.length).toBe(beforeLength);
  });
});
