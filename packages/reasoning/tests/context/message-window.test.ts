// Run: bun test packages/reasoning/tests/context/message-window.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { applyMessageWindowWithCompact } from "../../src/context/message-window.js";
import type { KernelMessage } from "../../src/kernel/state/kernel-state.js";

// ── applyMessageWindowWithCompact — sliding window behavior ──────────────────

describe("applyMessageWindowWithCompact", () => {
  it("returns messages untouched when under budget", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      { role: "assistant", content: "ok" },
    ];
    const out = applyMessageWindowWithCompact(messages, "local", 100000);
    expect(out.length).toBe(2);
    expect(out[0]?.content).toBe("task");
  }, 15000);

  it("preserves the first user message (task) as API cache prefix", () => {
    // Build a large conversation that will exceed budget.
    const BIG = "x".repeat(1000);
    const messages: KernelMessage[] = [
      { role: "user", content: "original task" },
      { role: "assistant", content: "calling", toolCalls: [{ id: "tc1", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "calling", toolCalls: [{ id: "tc2", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc2", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "calling", toolCalls: [{ id: "tc3", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc3", toolName: "web-search", content: BIG } as any,
    ];
    // Force budget to be tiny so sliding window fires.
    const out = applyMessageWindowWithCompact(messages, "local", 500, 1);

    // First message must be the original task
    expect(out[0]?.role).toBe("user");
    expect(out[0]?.content).toBe("original task");
  }, 15000);

  it("summarizes older turns as [Prior: called X → brief] when over budget", () => {
    const BIG = "x".repeat(1000);
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc1", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "", toolCalls: [{ id: "tc2", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc2", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "", toolCalls: [{ id: "tc3", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc3", toolName: "web-search", content: BIG } as any,
    ];
    const out = applyMessageWindowWithCompact(messages, "local", 500, 1);

    // Should include a [Prior: ...] summary for older turns
    const summary = out.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.startsWith("[Prior:"),
    );
    expect(summary).toBeDefined();
    expect(summary?.content).toContain("called web-search");
  }, 15000);

  it("never emits 'use recall(...)' hints (recall is off the critical path)", () => {
    const BIG = "x".repeat(1000);
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc1", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: BIG, storedKey: "_tool_result_1" } as any,
      { role: "assistant", content: "", toolCalls: [{ id: "tc2", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc2", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "", toolCalls: [{ id: "tc3", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc3", toolName: "web-search", content: BIG } as any,
    ];
    const out = applyMessageWindowWithCompact(messages, "local", 500, 1);

    const hasRecallHint = out.some(
      (m) => typeof m.content === "string" && m.content.includes("use recall"),
    );
    expect(hasRecallHint).toBe(false);
  }, 15000);

  it("keeps the most recent N turns in full (tier-adaptive)", () => {
    const BIG = "x".repeat(1000);
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [{ id: "tc1", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "", toolCalls: [{ id: "tc2", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc2", toolName: "web-search", content: BIG } as any,
      { role: "assistant", content: "last", toolCalls: [{ id: "tc3", name: "web-search", arguments: {} }] } as any,
      { role: "tool_result", toolCallId: "tc3", toolName: "web-search", content: "fresh content" } as any,
    ];
    const out = applyMessageWindowWithCompact(messages, "local", 500, 1);

    // The most recent turn's tool_result should be present with full content
    const recentResult = out.find(
      (m) => m.role === "tool_result" && (m as any).toolCallId === "tc3",
    ) as any;
    expect(recentResult).toBeDefined();
    expect(recentResult.content).toBe("fresh content");
  }, 15000);
});
