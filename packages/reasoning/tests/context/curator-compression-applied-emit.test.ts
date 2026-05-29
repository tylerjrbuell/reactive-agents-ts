// Run: bun test packages/reasoning/tests/context/curator-compression-applied-emit.test.ts
//
// Issue #119 / North Star v5.0 §4.3 — CompressionApplied typed-event emission.
//
// Triple compression coordination final closure:
//   1. CompressionRecommendation (typed) — emitted by reactive-observer at the
//      verbosity-detector AND dispatcher compress-messages handler sites.
//   2. Curator (buildConversationMessages) — sole authority that consumes the
//      recommendation and clamps the effective budget for the next prompt.
//   3. CompressionApplied (typed) — confirms the consumed recommendation,
//      pinning the recommendation→application chain end-to-end.
//
// Until this commit the curator emitted a console.debug fallback because
// buildConversationMessages is a pure synchronous helper that cannot open an
// Effect context. The lift returns a sidecar `compressionApplied` value so
// the Effect-context-capable caller (defaultContextCurator.curate ←
// ContextManager.build ← think.ts) can publish the typed event via EventBus.
//
// Invariants pinned here:
//   I1. Fresh recommendation consumed → sidecar returned with all 4 fields.
//   I2. Stale recommendation (>1 iteration old) → no sidecar.
//   I3. No recommendation at all → no sidecar.
//   I4. Sidecar carries the SAME targetTokens + reason + recommendedAtIteration
//       as the consumed recommendation; iteration matches state.iteration;
//       actualMessageCount matches the rendered thread length.

import { describe, it, expect } from "bun:test";
import { buildConversationMessages } from "../../src/kernel/capabilities/attend/context-utils.js";
import type {
  KernelState,
  KernelInput,
  KernelMessage,
} from "../../src/kernel/state/kernel-state.js";
import type { ContextProfile } from "../../src/context/context-profile.js";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";

const stubAdapter: ProviderAdapter = { name: "stub" } as unknown as ProviderAdapter;

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
    taskId: "t-applied",
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
  maxTokens: 100_000,
} as ContextProfile;

const baseInput: KernelInput = { task: "original task" };

describe("buildConversationMessages — CompressionApplied sidecar (#119 closure)", () => {
  it("I1+I4: fresh recommendation consumed returns sidecar with documented fields", () => {
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

    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);

    // The sidecar return shape: { messages, compressionApplied? }.
    expect(out).toHaveProperty("messages");
    expect(Array.isArray(out.messages)).toBe(true);
    // Sidecar present because the recommendation was fresh.
    expect(out.compressionApplied).toBeDefined();
    const sidecar = out.compressionApplied!;
    expect(sidecar.iteration).toBe(5);
    expect(sidecar.recommendedAtIteration).toBe(5);
    expect(sidecar.targetTokens).toBe(500);
    expect(sidecar.reason).toBe("context-pressure");
    expect(sidecar.actualMessageCount).toBe(out.messages.length);
  });

  it("I1: fresh recommendation from PRIOR iteration (delta=1) still produces sidecar", () => {
    const messages = makeBigThread(6, 1000);
    const state = makeState({
      iteration: 6,
      messages,
      meta: {
        pendingCompressionRecommendation: {
          targetTokens: 500,
          reason: "verbosity-detected",
          recommendedAtIteration: 5,
        },
      },
    });

    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);
    expect(out.compressionApplied).toBeDefined();
    expect(out.compressionApplied!.iteration).toBe(6);
    expect(out.compressionApplied!.recommendedAtIteration).toBe(5);
    expect(out.compressionApplied!.reason).toBe("verbosity-detected");
  });

  it("I2: stale recommendation (delta > 1) → no sidecar", () => {
    const messages = makeBigThread(3, 200);
    const state = makeState({
      iteration: 10,
      messages,
      meta: {
        pendingCompressionRecommendation: {
          targetTokens: 500,
          reason: "context-pressure",
          recommendedAtIteration: 3, // 10-3=7 > 1
        },
      },
    });

    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);
    expect(out.compressionApplied).toBeUndefined();
  });

  it("I3: no recommendation present → no sidecar, baseline message shape preserved", () => {
    const messages = makeBigThread(3, 200);
    const state = makeState({ messages });

    const out = buildConversationMessages(state, baseInput, baseProfile, stubAdapter);
    expect(out.compressionApplied).toBeUndefined();
    expect(out.messages.length).toBe(messages.length);
  });
});
