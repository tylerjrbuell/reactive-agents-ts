import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
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
import { turnCostOf } from "../services/chat-turn-cost.js";

function setup() {
  const path = `/tmp/cortex-chat-cost-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return {
    db,
    svc,
    cleanup: () => {
      db.close();
      rmSync(path, { force: true });
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
      const assistants = getChatTurns(db, id).filter((t) => t.role === "assistant");
      expect(assistants.at(-2)).toMatchObject({ costUsd: 0.002, costKnown: true });
      expect(assistants.at(-1)).toMatchObject({ costUsd: 0, costKnown: false });
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
  it("a failed spawn-agent(s) call marks the cost a lower bound", () => {
    const failed = { reasoningSteps: [], toolCalls: [{ id: "1", name: "spawn-agents", status: "failed" as const, iteration: 1 }] };
    const okTrace = { reasoningSteps: [], toolCalls: [{ id: "1", name: "spawn-agent", status: "done" as const, iteration: 1 }] };
    expect(turnCostOf(0.1, failed)).toEqual({ usd: 0.1, known: false });
    expect(turnCostOf(0.1, okTrace)).toEqual({ usd: 0.1, known: true });
  });
});

describe("session totals, fork, rewind, compact, migration", () => {
  it("totals sum tokens and cost in SQL; any unknown turn makes costKnown false", () => {
    const { db, cleanup } = setup();
    try {
      db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "a", tokensUsed: 10, costUsd: 0.01 });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "b", tokensUsed: 5, costUsd: 0.02 });
      expect(getChatSessionTotals(db, "s")).toEqual({ tokens: 15, costUsd: expect.closeTo(0.03, 6), costKnown: true });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "c", tokensUsed: 1, costUsd: 0, costKnown: false });
      expect(getChatSessionTotals(db, "s").costKnown).toBe(false);
      expect(getChatSessionTotals(db, "empty")).toEqual({ tokens: 0, costUsd: 0, costKnown: true });
    } finally {
      cleanup();
    }
  });

  it("fork copies cost with the turns; rewind drops it from totals; compact zeroes the summary", () => {
    const { db, cleanup } = setup();
    try {
      for (const s of ["a", "b"]) db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES (?, 'n', '{}')`).run(s);
      for (const n of [1, 2, 3]) {
        appendChatTurn(db, { sessionId: "a", role: "user", content: `u${n}`, tokensUsed: 0 });
        appendChatTurn(db, { sessionId: "a", role: "assistant", content: `r${n}`, tokensUsed: 10, costUsd: 0.01, costKnown: n !== 2 });
      }
      copyChatTurns(db, "a", "b");
      expect(getChatSessionTotals(db, "b")).toEqual({ tokens: 30, costUsd: expect.closeTo(0.03, 6), costKnown: false });
      const second = getChatTurns(db, "a").find((t) => t.content === "u3")!;
      rewindChatTurns(db, "a", second.id);
      expect(getChatSessionTotals(db, "a").costUsd).toBeCloseTo(0.02, 6);
      compactChatTurns(db, "a", 0, "summary");
      expect(getChatSessionTotals(db, "a")).toEqual({ tokens: 0, costUsd: 0, costKnown: true });
    } finally {
      cleanup();
    }
  });

  it("pre-migration rows load with cost 0 and known", () => {
    const path = `/tmp/cortex-chat-cost-mig-${crypto.randomUUID()}.db`;
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
      expect(getChatSessionTotals(db, "s")).toEqual({ tokens: 7, costUsd: 0, costKnown: true });
      db.close();
    } finally {
      rmSync(path, { force: true });
    }
  });

  it("getSession returns totals computed from the rows", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      appendChatTurn(db, { sessionId: id, role: "assistant", content: "x", tokensUsed: 4, costUsd: 0.5 });
      expect(svc.getSession(id)?.totals).toEqual({ tokens: 4, costUsd: 0.5, costKnown: true });
    } finally {
      cleanup();
    }
  });
});
