import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, getChatTurns, getChatSessionTotals } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

function setup() {
  const path = `/tmp/cortex-chat-split-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return { db, svc, cleanup: () => { db.close(); rmSync(path, { force: true }); } };
}

type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown; chat: unknown } }> };

describe("chat token split persistence", () => {
  it("migrates an older table on reopen without throwing", () => {
    const path = `/tmp/cortex-chat-split-mig-${crypto.randomUUID()}.db`;
    const db1 = openDatabase(path);
    db1.close();
    const db2 = openDatabase(path);
    expect(() => db2.prepare("PRAGMA table_info(cortex_chat_turns)").all()).not.toThrow();
    db2.close();
    rmSync(path, { force: true });
  });

  it("round-trips tokensIn/tokensOut; absent stays absent", () => {
    const { db, cleanup } = setup();
    try {
      db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "a", tokensUsed: 1500, inputTokens: 1000, outputTokens: 500 });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "b", tokensUsed: 400 });
      const [a, b] = getChatTurns(db, "s");
      expect(a!.tokensIn).toBe(1000);
      expect(a!.tokensOut).toBe(500);
      expect("tokensIn" in (b ?? {})).toBe(false);
      expect("tokensOut" in (b ?? {})).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("getChatSessionTotals sums halves and reports splitComplete", () => {
    const { db, cleanup } = setup();
    try {
      db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "a", tokensUsed: 1500, inputTokens: 1000, outputTokens: 500 });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "b", tokensUsed: 400, inputTokens: 300, outputTokens: 100 });
      const t = getChatSessionTotals(db, "s");
      expect(t.tokens).toBe(1900);
      expect(t.tokensIn).toBe(1300);
      expect(t.tokensOut).toBe(600);
      expect(t.splitComplete).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("getChatSessionTotals reports incomplete when a turn lacks a half", () => {
    const { db, cleanup } = setup();
    try {
      db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "a", tokensUsed: 1500, inputTokens: 1000, outputTokens: 500 });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "b", tokensUsed: 400 });
      const t = getChatSessionTotals(db, "s");
      expect(t.splitComplete).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("a streamed turn persists the split from StreamCompleted metadata", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      (svc as unknown as Internal).sessions.get(id)!.session.runStream = async function* (): AsyncGenerator<FakeEvent> {
        yield { _tag: "TextDelta", text: "hi" };
        yield { _tag: "StreamCompleted", output: "hi", metadata: { tokensUsed: 1500, inputTokens: 1000, outputTokens: 500, cost: 0, stepsCount: 1, duration: 1 } };
      };
      for await (const _ of svc.chatStream(id, "go")) void _;
      const last = getChatTurns(db, id).filter((t) => t.role === "assistant").at(-1)!;
      expect(last.tokensIn).toBe(1000);
      expect(last.tokensOut).toBe(500);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("a direct no-tools turn persists the split from the ChatReply", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: false } });
      await svc.chat(id, "warm");
      (svc as unknown as Internal).sessions.get(id)!.session.chat = async () => ({
        message: "hi",
        tokens: 1500,
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0,
      });
      await svc.chat(id, "go");
      const last = getChatTurns(db, id).filter((t) => t.role === "assistant").at(-1)!;
      expect(last.tokensIn).toBe(1000);
      expect(last.tokensOut).toBe(500);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });
});