// Run: bun test packages/reasoning/tests/context/message-window.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { applyMessageWindowWithCompact } from "../../src/context/message-window.js";
import type { KernelMessage } from "../../src/strategies/kernel/kernel-state.js";

// ── applyMessageWindowWithCompact — storedKey recall hint ─────────────────────

describe("applyMessageWindowWithCompact storedKey", () => {
  it("uses storedKey in recall hint when available on tool_result", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "Find XRP price" },
      {
        role: "assistant", content: "I will search",
        toolCalls: [{ id: "call-1", name: "web-search", arguments: { query: "XRP price" } }],
      } as any,
      {
        role: "tool_result", toolCallId: "call-1", toolName: "web-search",
        content: "A".repeat(300),
        storedKey: "_tool_result_1",
      } as any,
      {
        role: "assistant", content: "Now let me search more",
        toolCalls: [{ id: "call-2", name: "web-search", arguments: { query: "BTC price" } }],
      } as any,
      {
        role: "tool_result", toolCallId: "call-2", toolName: "web-search",
        content: "B".repeat(300),
        storedKey: "_tool_result_2",
      } as any,
      {
        role: "assistant", content: "Another search",
        toolCalls: [{ id: "call-3", name: "web-search", arguments: { query: "ETH price" } }],
      } as any,
      {
        role: "tool_result", toolCallId: "call-3", toolName: "web-search",
        content: "C".repeat(300),
        storedKey: "_tool_result_3",
      } as any,
    ];

    const result = applyMessageWindowWithCompact(messages, {
      tier: "local",
      maxTokens: 8192,
      frozenToolResultIds: new Set(),
      keepFullTurns: 1,
    });

    // The first tool_result (old turn) should have been micro-compacted
    // with the correct _tool_result_1 key, not the provider-assigned call-1
    const compactedMsg = result.messages.find(
      (m) => m.role === "tool_result" && (m as any).toolCallId === "call-1",
    );
    if (compactedMsg) {
      expect((compactedMsg as any).content).toContain("_tool_result_1");
      expect((compactedMsg as any).content).not.toContain("call-1");
    }
  }, 15000);

  it("falls back to toolCallId when storedKey is absent", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "Find prices" },
      {
        role: "assistant", content: "searching",
        toolCalls: [{ id: "call-1", name: "web-search", arguments: {} }],
      } as any,
      {
        role: "tool_result", toolCallId: "call-1", toolName: "web-search",
        content: "X".repeat(300),
        // No storedKey
      } as any,
      {
        role: "assistant", content: "more searching",
        toolCalls: [{ id: "call-2", name: "web-search", arguments: {} }],
      } as any,
      {
        role: "tool_result", toolCallId: "call-2", toolName: "web-search",
        content: "Y".repeat(300),
      } as any,
    ];

    const result = applyMessageWindowWithCompact(messages, {
      tier: "local",
      maxTokens: 8192,
      frozenToolResultIds: new Set(),
      keepFullTurns: 1,
    });

    const compactedMsg = result.messages.find(
      (m) => m.role === "tool_result" && (m as any).toolCallId === "call-1",
    );
    if (compactedMsg) {
      // Falls back to toolCallId when no storedKey
      expect((compactedMsg as any).content).toContain("call-1");
    }
  }, 15000);
});
