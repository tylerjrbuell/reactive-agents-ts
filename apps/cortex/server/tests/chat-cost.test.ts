import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import {
  appendChatTurn,
  compactChatTurns,
  copyChatTurns,
  getChatSessionTotals,
  getChatTurns,
  rewindChatTurns,
} from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { addUsageCost, completedTurnCostOf, reportedTurnCostOf, turnCostOf } from "../services/chat-turn-cost.js";
import { EMPTY_COST_SUM } from "@reactive-agents/core";

function setup() {
  const path = tmpDbPath("chat-cost");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return {
    db,
    svc,
    cleanup: () => {
      db.close();
      rmDbFiles(path);
    },
  };
}
const cfg = { provider: "test", model: "test-model" };

type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown; chat: unknown } }> };

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) void _;
}

describe("chat turn cost persistence", () => {
  it("a streamed turn persists cost_usd from StreamCompleted.metadata.cost", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { ...cfg, enableTools: true } });
      await svc.chat(id, "warm"); // builds + caches the engine session
      const internal = svc as unknown as Internal;
      internal.sessions.get(id)!.session.runStream = async function* (): AsyncGenerator<FakeEvent> {
        yield { _tag: "TextDelta", text: "hi" };
        yield { _tag: "StreamCompleted", output: "hi", metadata: { tokensUsed: 10, cost: 0.0042, stepsCount: 1, duration: 1 } };
      };
      await drain(svc.chatStream(id, "go"));
      const last = getChatTurns(db, id).filter((t) => t.role === "assistant").at(-1)!;
      expect(last.costUsd).toBeCloseTo(0.0042, 6);
      expect(last.costKnown).toBe(true);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("a streamed turn with a failed sub-agent persists costKnown:false", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { ...cfg, enableTools: true } });
      await svc.chat(id, "warm");
      const internal = svc as unknown as Internal;
      internal.sessions.get(id)!.session.runStream = async function* (): AsyncGenerator<FakeEvent> {
        yield { _tag: "ToolCallStarted", callId: "c1", toolName: "spawn-agent", iteration: 1 };
        yield { _tag: "ToolCallCompleted", callId: "c1", toolName: "spawn-agent", success: false, error: "child failed", durationMs: 5 };
        yield { _tag: "StreamCompleted", output: "partial", metadata: { tokensUsed: 10, cost: 0.01, stepsCount: 1, duration: 1 } };
      };
      await drain(svc.chatStream(id, "delegate"));
      const last = getChatTurns(db, id).filter((t) => t.role === "assistant").at(-1)!;
      expect(last.costUsd).toBeCloseTo(0.01, 6);
      expect(last.costKnown).toBe(false);
      expect(getChatSessionTotals(db, id).costKnown).toBe(false);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("the direct path persists reply cost; a reply without cost is flagged costKnown:false", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      await svc.chat(id, "warm");
      const internal = svc as unknown as Internal;
      internal.sessions.get(id)!.session.chat = async () => ({ message: "a", tokens: 5, cost: 0.002, toolsUsed: [] });
      await svc.chat(id, "priced");
      internal.sessions.get(id)!.session.chat = async () => ({ message: "b", tokens: 5, toolsUsed: [] });
      await svc.chat(id, "unpriced");
      // ChatReply.costComplete:false (a call had no known price): the dollars are a lower bound.
      internal.sessions.get(id)!.session.chat = async () => ({ message: "c", tokens: 5, cost: 0.003, costComplete: false, toolsUsed: [] });
      await svc.chat(id, "partly priced");
      const assistants = getChatTurns(db, id).filter((t) => t.role === "assistant");
      expect(assistants.at(-3)).toMatchObject({ costUsd: 0.002, costKnown: true });
      expect(assistants.at(-2)).toMatchObject({ costUsd: 0, costKnown: false });
      expect(assistants.at(-1)).toMatchObject({ costUsd: 0.003, costKnown: false });
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("the streamed direct path's StreamCompleted carries costComplete:false for an unpriced or partial reply", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      await svc.chat(id, "warm");
      const internal = svc as unknown as Internal;
      const completedOf = async (): Promise<Record<string, unknown> | undefined> => {
        for await (const ev of svc.chatStream(id, "go")) {
          const e = ev as { _tag?: string; metadata?: Record<string, unknown> };
          if (e._tag === "StreamCompleted") return e.metadata;
        }
        return undefined;
      };
      internal.sessions.get(id)!.session.chat = async () => ({ message: "a", tokens: 5, cost: 0.002, toolsUsed: [] });
      expect(await completedOf()).toMatchObject({ cost: 0.002 });
      expect((await completedOf())?.costComplete).toBeUndefined();
      internal.sessions.get(id)!.session.chat = async () => ({ message: "b", tokens: 5, toolsUsed: [] });
      expect(await completedOf()).toMatchObject({ cost: 0, costComplete: false });
      internal.sessions.get(id)!.session.chat = async () => ({ message: "c", tokens: 5, cost: 0.003, costComplete: false, toolsUsed: [] });
      expect(await completedOf()).toMatchObject({ cost: 0.003, costComplete: false });
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });
});

describe("turnCostOf", () => {
  it("is known for a numeric cost and unknown when absent", () => {
    expect(turnCostOf(0.5, undefined)).toEqual({ usd: 0.5, known: true });
    expect(turnCostOf(undefined, undefined)).toEqual({ usd: 0, known: false });
  });
  it("an incomplete total (an unpriced call) keeps the dollars as a lower bound", () => {
    expect(turnCostOf(0.5, undefined, false)).toEqual({ usd: 0.5, known: false });
  });
  it("a failed spawn-agent(s) call marks the cost a lower bound", () => {
    const failed = { reasoningSteps: [], toolCalls: [{ id: "1", name: "spawn-agents", status: "failed" as const, iteration: 1 }] };
    const okTrace = { reasoningSteps: [], toolCalls: [{ id: "1", name: "spawn-agent", status: "done" as const, iteration: 1 }] };
    expect(turnCostOf(0.1, failed)).toEqual({ usd: 0.1, known: false });
    expect(turnCostOf(0.1, okTrace)).toEqual({ usd: 0.1, known: true });
  });
});

describe("streamed turn cost helpers", () => {
  it("an unpriced TokenUsage adds nothing and marks the sum incomplete, never NaN", () => {
    const sum = addUsageCost(addUsageCost(EMPTY_COST_SUM, { costUsd: 0.02 }), {});
    expect(sum).toEqual({ usd: 0.02, complete: false });
    expect(addUsageCost(EMPTY_COST_SUM, { costUsd: 0.5, priceSource: "unknown" })).toEqual({ usd: 0, complete: false });
  });
  it("reported cost: nothing reported is unknown, an incomplete sum is a lower bound", () => {
    expect(reportedTurnCostOf(EMPTY_COST_SUM, undefined)).toEqual({ usd: 0, known: false });
    expect(reportedTurnCostOf({ usd: 0.3, complete: true }, undefined)).toEqual({ usd: 0.3, known: true });
    expect(reportedTurnCostOf({ usd: 0, complete: false }, undefined)).toEqual({ usd: 0, known: false });
  });
  it("completed cost honours metadata costComplete", () => {
    expect(completedTurnCostOf({ cost: 0.4 }, undefined)).toEqual({ usd: 0.4, known: true });
    expect(completedTurnCostOf({ cost: 0.4, costComplete: false }, undefined)).toEqual({ usd: 0.4, known: false });
    expect(completedTurnCostOf(undefined, undefined)).toEqual({ usd: 0, known: false });
  });
});

describe("session totals, fork, rewind, compact, migration", () => {
  it("totals sum tokens and cost in SQL; any unknown turn makes costKnown false", () => {
    const { db, cleanup } = setup();
    try {
      db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "a", tokensUsed: 10, costUsd: 0.01 });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "b", tokensUsed: 5, costUsd: 0.02 });
      expect(getChatSessionTotals(db, "s")).toEqual({ tokens: 15, tokensIn: 0, tokensOut: 0, splitComplete: false, costUsd: expect.closeTo(0.03, 6), costKnown: true });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "c", tokensUsed: 1, costUsd: 0, costKnown: false });
      expect(getChatSessionTotals(db, "s").costKnown).toBe(false);
      expect(getChatSessionTotals(db, "empty")).toEqual({ tokens: 0, tokensIn: 0, tokensOut: 0, splitComplete: true, costUsd: 0, costKnown: true });
    } finally {
      cleanup();
    }
  });

  it("fork copies cost with the turns; rewind drops it from totals; compact keeps session totals", () => {
    const { db, cleanup } = setup();
    try {
      for (const s of ["a", "b"]) db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES (?, 'n', '{}')`).run(s);
      for (const n of [1, 2, 3]) {
        appendChatTurn(db, { sessionId: "a", role: "user", content: `u${n}`, tokensUsed: 0 });
        appendChatTurn(db, { sessionId: "a", role: "assistant", content: `r${n}`, tokensUsed: 10, costUsd: 0.01, costKnown: n !== 2 });
      }
      copyChatTurns(db, "a", "b");
      expect(getChatSessionTotals(db, "b")).toEqual({ tokens: 30, tokensIn: 0, tokensOut: 0, splitComplete: false, costUsd: expect.closeTo(0.03, 6), costKnown: false });
      const second = getChatTurns(db, "a").find((t) => t.content === "u3")!;
      rewindChatTurns(db, "a", second.id);
      expect(getChatSessionTotals(db, "a").costUsd).toBeCloseTo(0.02, 6);
      const before = getChatSessionTotals(db, "a");
      compactChatTurns(db, "a", 0, "summary");
      const after = getChatSessionTotals(db, "a");
      expect(after.tokens).toBe(before.tokens);
      expect(after.costUsd).toBeCloseTo(before.costUsd, 6);
      expect(after.costKnown).toBe(before.costKnown);
    } finally {
      cleanup();
    }
  });

  it("pre-migration rows load with cost 0 and known", () => {
    const path = tmpDbPath("chat-cost-mig");
    try {
      const first = openDatabase(path);
      first.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      first.exec(`ALTER TABLE cortex_chat_turns DROP COLUMN cost_usd`);
      first.exec(`ALTER TABLE cortex_chat_turns DROP COLUMN cost_known`);
      first.prepare(`INSERT INTO cortex_chat_turns (session_id, role, content, tokens_used) VALUES ('s','assistant','old',7)`).run();
      first.close();
      const db = openDatabase(path); // re-open runs the additive migration
      const [turn] = getChatTurns(db, "s");
      expect(turn).toMatchObject({ costUsd: 0, costKnown: true });
      expect(getChatSessionTotals(db, "s")).toEqual({ tokens: 7, tokensIn: 0, tokensOut: 0, splitComplete: false, costUsd: 0, costKnown: true });
      db.close();
    } finally {
      rmDbFiles(path);
    }
  });

  it("getSession returns totals computed from the rows", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      appendChatTurn(db, { sessionId: id, role: "assistant", content: "x", tokensUsed: 4, costUsd: 0.5 });
      expect(svc.getSession(id)?.totals).toEqual({ tokens: 4, tokensIn: 0, tokensOut: 0, splitComplete: false, costUsd: 0.5, costKnown: true });
    } finally {
      cleanup();
    }
  });
});
