import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

function setup() {
  const path = `/tmp/cortex-chat-ctx-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return { db, svc, cleanup: () => { db.close(); rmSync(path, { force: true }); } };
}
type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown } }> };

describe("chat turn context persistence", () => {
  it("appendChatTurn round-trips a context reading", () => {
    const { db, cleanup } = setup();
    try {
      db.prepare(`INSERT INTO cortex_chat_sessions (session_id, name, agent_config) VALUES ('s','n','{}')`).run();
      const context = { tokensUsed: 800, windowTokens: 4000, utilizationPct: 20, level: "low" as const };
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "a", tokensUsed: 1, context });
      appendChatTurn(db, { sessionId: "s", role: "assistant", content: "b", tokensUsed: 1 });
      const [a, b] = getChatTurns(db, "s");
      expect(a!.context).toEqual(context);
      expect(b!.context).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("a streamed turn persists the last ContextPressure reading", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      await svc.chat(id, "warm");
      (svc as unknown as Internal).sessions.get(id)!.session.runStream = async function* (): AsyncGenerator<FakeEvent> {
        yield { _tag: "ContextPressure", taskId: "t", utilizationPct: 10, tokensUsed: 100, tokensAvailable: 900, level: "low" };
        yield { _tag: "ContextPressure", taskId: "t", utilizationPct: 30, tokensUsed: 300, tokensAvailable: 700, level: "medium" };
        yield { _tag: "TextDelta", text: "hi" };
        yield { _tag: "StreamCompleted", output: "hi", metadata: { tokensUsed: 10, cost: 0, stepsCount: 1, duration: 1 } };
      };
      for await (const _ of svc.chatStream(id, "go")) void _;
      const last = getChatTurns(db, id).filter((t) => t.role === "assistant").at(-1)!;
      expect(last.context).toEqual({ tokensUsed: 300, windowTokens: 1000, utilizationPct: 30, level: "medium" });
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });
});
