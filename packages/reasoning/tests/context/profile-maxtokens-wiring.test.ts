import { describe, it, expect } from "bun:test";
import { buildConversationMessages } from "../../src/kernel/capabilities/attend/context-utils.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import type { KernelState, KernelInput } from "../../src/kernel/state/kernel-state.js";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";

// A no-op adapter — taskFraming is the only method buildConversationMessages may call.
const stubAdapter = {} as ProviderAdapter;

// Build a message thread that is ~7000 tokens (well over 75% of an 8192 window
// = 6144, but far under 75% of MAX_SAFE_INTEGER).
function bigState(): KernelState {
  const filler = "x".repeat(5000); // ~1250 tokens at 4 chars/token; 6 results ≈ 7500 tok
  const messages = [
    { role: "user" as const, content: "Original task: research crypto and report." },
    { role: "assistant" as const, content: "thinking 1", toolCalls: [{ id: "1", name: "web-search", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "1", toolName: "web-search", content: filler },
    { role: "assistant" as const, content: "thinking 2", toolCalls: [{ id: "2", name: "web-search", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "2", toolName: "web-search", content: filler },
    { role: "assistant" as const, content: "thinking 3", toolCalls: [{ id: "3", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "3", toolName: "crypto-price", content: filler },
    { role: "assistant" as const, content: "thinking 4", toolCalls: [{ id: "4", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "4", toolName: "crypto-price", content: filler },
    { role: "assistant" as const, content: "thinking 5", toolCalls: [{ id: "5", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "5", toolName: "crypto-price", content: filler },
    { role: "assistant" as const, content: "thinking 6", toolCalls: [{ id: "6", name: "crypto-price", arguments: {} }] },
    { role: "tool_result" as const, toolCallId: "6", toolName: "crypto-price", content: filler },
  ];
  return { messages, steps: [], iteration: 6, tokens: 7000 } as unknown as KernelState;
}

describe("Bug 1b — compaction reads resolved profile.maxTokens, not input.contextProfile", () => {
  it("compacts when state exceeds 75% of resolved profile.maxTokens and NO input.contextProfile is set", () => {
    const state = bigState();
    // Caller passes NO contextProfile — the realistic default path.
    const input = { task: "research crypto", availableToolSchemas: [] } as unknown as KernelInput;
    // Resolved profile carries an 8192 window (e.g. cogito:14b after Task 2).
    const profile = { ...CONTEXT_PROFILES.local, maxTokens: 8192 };

    const out = buildConversationMessages(state, input, profile, stubAdapter);

    // 13 raw messages, 6 turns; local keeps first user + last 2 turns + [Prior:].
    expect(out.length).toBeLessThan(state.messages.length);
    const joined = out.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ");
    expect(joined).toContain("[Prior:");
  });

  it("does NOT compact when resolved profile.maxTokens is large enough for the thread", () => {
    const state = bigState();
    const input = { task: "research crypto", availableToolSchemas: [] } as unknown as KernelInput;
    const profile = { ...CONTEXT_PROFILES.frontier, maxTokens: 128_000 };

    const out = buildConversationMessages(state, input, profile, stubAdapter);
    expect(out.length).toBe(state.messages.length);
  });
});
