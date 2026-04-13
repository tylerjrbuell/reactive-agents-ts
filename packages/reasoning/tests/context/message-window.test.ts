import { describe, it, expect } from "bun:test";
import { applyMessageWindow, applyMessageWindowWithCompact } from "../../src/context/message-window.js";
import type { KernelMessage } from "../../src/strategies/kernel/kernel-state.js";
import type { ContextProfile } from "../../src/context/context-profile.js";

const makeProfile = (tier: string, contextBudgetPercent: number): ContextProfile => ({
  tier: tier as ContextProfile["tier"],
  contextBudgetPercent,
  promptVerbosity: "standard",
  rulesComplexity: "standard",
  fewShotExampleCount: 1,
  compactAfterSteps: 6,
  fullDetailSteps: 4,
  toolSchemaDetail: "full",
  toolResultMaxChars: 800,
  toolResultPreviewItems: 5,
  temperature: 0.7,
  maxIterations: 10,
});

const makeMessages = (count: number): KernelMessage[] => {
  const msgs: KernelMessage[] = [{ role: "user", content: "Initial task - do research and write a report" }];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: "assistant",
      content: `Thinking about step ${i}...`,
      toolCalls: [{ id: `tc${i}`, name: "web-search", arguments: { query: `query ${i}` } }],
    });
    msgs.push({
      role: "tool_result",
      toolCallId: `tc${i}`,
      toolName: "web-search",
      content: `Search result ${i}: ` + "x".repeat(200),
    });
  }
  return msgs;
};

describe("applyMessageWindow", () => {
  it("returns messages unchanged when under budget", () => {
    const msgs = makeMessages(2);
    // High budget percent → no compaction needed
    const result = applyMessageWindow(msgs, makeProfile("frontier", 100));
    expect(result).toHaveLength(msgs.length);
  });

  it("always keeps first user message (the task)", () => {
    const msgs = makeMessages(20);
    // Very low budget to force compaction
    const result = applyMessageWindow(msgs, makeProfile("local", 1));
    expect(result[0]).toEqual({ role: "user", content: "Initial task - do research and write a report" });
  });

  it("keeps last N turns for local tier", () => {
    const msgs = makeMessages(10);
    const result = applyMessageWindow(msgs, makeProfile("local", 1));
    const assistantCount = result.filter(m => m.role === "assistant").length;
    // local tier keeps 2 full turns
    expect(assistantCount).toBeLessThanOrEqual(3);
  });

  it("inserts summary message when compaction fires", () => {
    const msgs = makeMessages(10);
    const result = applyMessageWindow(msgs, makeProfile("local", 1));
    const hasSummary = result.some(m =>
      m.role === "user" && typeof m.content === "string" && m.content.startsWith("[Summary of prior work:")
    );
    expect(hasSummary).toBe(true);
  });

  it("handles empty messages", () => {
    expect(applyMessageWindow([], makeProfile("mid", 80))).toEqual([]);
  });

  it("keeps more turns for frontier tier", () => {
    const msgs = makeMessages(20);
    const resultLocal = applyMessageWindow(msgs, makeProfile("local", 1));
    const resultFrontier = applyMessageWindow(msgs, makeProfile("frontier", 1));
    const localAssistants = resultLocal.filter(m => m.role === "assistant").length;
    const frontierAssistants = resultFrontier.filter(m => m.role === "assistant").length;
    expect(frontierAssistants).toBeGreaterThan(localAssistants);
  });

  it("does not compact when turns count <= fullTurns", () => {
    // local tier fullTurns=2, make exactly 2 turns but over budget
    const msgs = makeMessages(2);
    const result = applyMessageWindow(msgs, makeProfile("local", 1));
    // 2 turns <= 2 fullTurns for local, so should not compact
    expect(result).toHaveLength(msgs.length);
  });
});

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
  });

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
  });
});
