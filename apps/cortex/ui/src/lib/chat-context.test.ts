import { describe, expect, it } from "bun:test";
import { carryContext, latestContext } from "./chat-context.js";
import type { ChatContext, ChatTurn } from "./stores/chat-store.js";

const ctx = (pct: number): ChatContext => ({ tokensUsed: pct * 10, windowTokens: 1000, utilizationPct: pct, level: "low" });
const turn = (id: number, role: "user" | "assistant", context?: ChatContext): ChatTurn =>
  ({ id, role, content: "x", tokensUsed: 0, ts: 0, ...(context ? { context } : {}) }) as ChatTurn;

describe("latestContext", () => {
  it("is the newest reading, skipping turns without one (idle and mid-run keep the previous)", () => {
    const turns = [turn(1, "user"), turn(2, "assistant", ctx(20)), turn(3, "user"), turn(4, "assistant")];
    expect(latestContext(turns)?.utilizationPct).toBe(20);
  });
  it("a newer reading replaces the previous", () => {
    expect(latestContext([turn(2, "assistant", ctx(20)), turn(4, "assistant", ctx(35))])?.utilizationPct).toBe(35);
  });
  it("is undefined when no turn has a reading", () => {
    expect(latestContext([turn(1, "user")])).toBeUndefined();
  });
});

describe("carryContext", () => {
  it("re-attaches the local reading when server rows carry none", () => {
    const local = [turn(1, "user"), turn(2, "assistant", ctx(40))];
    const server = [turn(11, "user"), turn(12, "assistant")];
    expect(latestContext(carryContext(local, server))?.utilizationPct).toBe(40);
  });
  it("prefers the server's persisted reading", () => {
    const local = [turn(2, "assistant", ctx(40))];
    const server = [turn(12, "assistant", ctx(55))];
    expect(latestContext(carryContext(local, server))?.utilizationPct).toBe(55);
  });
  it("hydrating from persisted turns alone yields the last reading", () => {
    expect(latestContext(carryContext([], [turn(1, "assistant", ctx(12)), turn(2, "assistant")]))?.utilizationPct).toBe(12);
  });
});
