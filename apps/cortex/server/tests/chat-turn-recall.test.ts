// Run: bun run repo test apps/cortex/server/tests/chat-turn-recall.test.ts
/**
 * A chat turn stores the memories its run RECALLED, from the run's own `MemoryRecalled`
 * events, and the stored trace survives a reload (the chat-queries whitelist keeps it).
 */
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { recordRecallActivity, withTurnRecall } from "../services/chat-turn-recall.js";

const recalled = (taskId: string, tier: string, items: { id: string; summary: string; score?: number }[], query?: string): AgentEvent =>
  ({ _tag: "MemoryRecalled", taskId, tier, items: items.map((i) => ({ ...i, tier })), ...(query ? { query } : {}) }) as AgentEvent;

describe("recordRecallActivity", () => {
  it("keeps each run's recalled items, deduped, and reports nothing for a run with no event", async () => {
    let emit: (e: AgentEvent) => void = () => {};
    const { log, unsubscribe } = await recordRecallActivity({
      subscribe: async (h) => {
        emit = h;
        return () => {};
      },
    });
    emit(recalled("t1", "semantic", [{ id: "s1", summary: "Prefers tabs", score: 0.9 }]));
    emit(recalled("t1", "semantic", [{ id: "s1", summary: "Prefers tabs", score: 0.9 }, { id: "s2", summary: "Uses bun" }], "tooling"));
    emit(recalled("t2", "procedural", [{ id: "p1", summary: "release flow" }]));
    emit({ _tag: "AgentStarted", taskId: "t1", agentId: "a", provider: "test", model: "m", timestamp: 1 } as AgentEvent);
    expect(log.recalledOf("t1")?.map((m) => m.id)).toEqual(["s1", "s2"]);
    expect(log.recalledOf("t2")?.[0]).toMatchObject({ tier: "procedural", id: "p1" });
    expect(log.recalledOf("none")).toBeUndefined();
    expect(log.recalledOf(undefined)).toBeUndefined();
    unsubscribe();
  });
});

describe("withTurnRecall", () => {
  it("leaves a trace without recall unchanged and adds recalled to one with it", () => {
    expect(withTurnRecall(undefined, undefined)).toBeUndefined();
    expect(withTurnRecall(undefined, [{ id: "s1", tier: "semantic", summary: "x" }])?.recalled).toHaveLength(1);
  });

  it("a stored recalled list survives a reload (empty list included)", () => {
    const db = openDatabase(":memory:");
    const sessionId = createChatSession(db, { agentConfig: {} });
    const trace = withTurnRecall(undefined, [{ id: "s1", tier: "semantic", summary: "x", score: 0.5 }])!;
    appendChatTurn(db, { sessionId, role: "assistant", content: "hi", tokensUsed: 0, trace });
    expect(getChatTurns(db, sessionId)[0]?.trace?.recalled).toEqual([{ id: "s1", tier: "semantic", summary: "x", score: 0.5 }]);
    db.close();
  });
});
