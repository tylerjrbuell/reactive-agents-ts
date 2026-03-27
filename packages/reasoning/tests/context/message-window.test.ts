import { describe, it, expect } from "bun:test";
import { applyMessageWindow } from "../../src/context/message-window.js";
import type { KernelMessage } from "../../src/strategies/shared/kernel-state.js";
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
