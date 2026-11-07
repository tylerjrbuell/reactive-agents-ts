import { describe, expect, test } from "bun:test";
import { buildSessionContext } from "./chat-session-context.js";
import type { ChatSession, ChatTurn } from "./stores/chat-store.js";
import type { ChatTotals } from "./stores/chat-cost.js";

const turn = (over: Partial<ChatTurn>): ChatTurn => ({
  id: 1,
  role: "assistant",
  content: "hi",
  tokensUsed: 100,
  ts: 1000,
  ...over,
});

describe("buildSessionContext", () => {
  test("counts messages by role", () => {
    const m = buildSessionContext({
      turns: [turn({ id: 1, role: "user", content: "q" }), turn({ id: 2, role: "assistant", content: "a" })],
    });
    expect(m.messageCount).toBe(2);
    expect(m.userCount).toBe(1);
    expect(m.assistantCount).toBe(1);
  });

  test("tokens from totals; ~ when split incomplete", () => {
    const totals: ChatTotals = { tokens: 1500, costUsd: 0.01, costKnown: true, tokensIn: 1000, tokensOut: 500, splitComplete: false };
    const m = buildSessionContext({ totals, turns: [] });
    expect(m.totalTokens).toBe(1500);
    expect(m.inputTokens).toBe(1000);
    expect(m.outputTokens).toBe(500);
    expect(m.splitComplete).toBe(false);
  });

  test("context limit and usage from latestContext; ~ when estimated", () => {
    const m = buildSessionContext({
      turns: [],
      latestContext: { tokensUsed: 1000, windowTokens: 4000, utilizationPct: 25, level: "low", estimated: true },
    });
    expect(m.contextLimit).toBe(4000);
    expect(m.usagePct).toBe(25);
    expect(m.estimated).toBe(true);
  });

  test("missing context yields null limit and no percentage", () => {
    const m = buildSessionContext({ turns: [] });
    expect(m.contextLimit).toBeNull();
    expect(m.usagePct).toBeNull();
    expect(m.estimated).toBe(false);
  });

  test("cache partial when an assistant turn has tokens but no usage", () => {
    const m = buildSessionContext({
      turns: [turn({ tokensUsed: 100, usage: { calls: [{ callId: "a", tokensTotal: 100, tokensIn: 60, tokensOut: 40, estimated: false, model: "m", provider: "p", durationMs: 1, costUsd: 0.01, cacheReadTokensIn: 10, cacheCreationTokensIn: 5 }], tokensIn: 60, tokensOut: 40, tokensTotal: 100, estimated: false, costUsd: 0.01, cacheReadTokensIn: 10, cacheCreationTokensIn: 5 } }), turn({ id: 2, tokensUsed: 50 })],
    });
    expect(m.cacheReadTokens).toBe(10);
    expect(m.cacheWriteTokens).toBe(5);
    expect(m.cachePartial).toBe(true);
  });

  test("thinking estimate sums thoughts with charsToTokens", () => {
    const m = buildSessionContext({
      turns: [turn({ reasoningSteps: [{ iteration: 1, maxIterations: 0, thought: "a".repeat(8) }] })],
    });
    expect(m.thinkingTokens).toBe(2);
  });

  test("zero thoughts yields zero thinking tokens", () => {
    const m = buildSessionContext({ turns: [turn({})] });
    expect(m.thinkingTokens).toBe(0);
  });

  test("session timestamps; missing session yields dashes handled by null", () => {
    const session: ChatSession = { sessionId: "s", name: "Chat", agentConfig: { provider: "anthropic", model: "m" }, createdAt: 10, lastUsedAt: 20 };
    const m = buildSessionContext({ session, turns: [] });
    expect(m.sessionName).toBe("Chat");
    expect(m.provider).toBe("anthropic");
    expect(m.model).toBe("m");
    expect(m.createdAt).toBe(10);
    expect(m.lastActivity).toBe(20);
  });

  test("missing session yields placeholder name and null timestamps", () => {
    const m = buildSessionContext({ turns: [] });
    expect(m.sessionName).toBe("–");
    expect(m.createdAt).toBeNull();
    expect(m.lastActivity).toBeNull();
  });

  test("streaming turn liveTokens overrides the persisted total", () => {
    const totals: ChatTotals = { tokens: 1000, costUsd: 0, costKnown: true };
    const m = buildSessionContext({
      totals,
      turns: [turn({ streaming: true, liveTokens: 250 })],
    });
    expect(m.totalTokens).toBe(1250);
  });

  test("raw messages include role, id, ts, tokens", () => {
    const m = buildSessionContext({
      turns: [turn({ id: 7, role: "user", content: "q", ts: 5, tokensUsed: 0 }), turn({ id: 8, role: "assistant", content: "a", ts: 6, tokensUsed: 42 })],
    });
    expect(m.rawMessages).toHaveLength(2);
    expect(m.rawMessages[0]).toMatchObject({ id: 7, role: "user", ts: 5 });
    expect(m.rawMessages[1]).toMatchObject({ id: 8, role: "assistant", tokens: 42 });
  });
});
