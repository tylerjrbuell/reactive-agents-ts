import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, getChatTurns, type ChatTurnRow } from "../db/chat-queries.js";
import { ChatSessionService, turnsToChatMessages } from "../services/chat-session-service.js";

const DB = "/tmp/cortex-chat-shaped-test.db";
const SHAPED = '{"name":"web-search","parameters":{"query":"x"}}';
let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  db = openDatabase(DB);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(DB, { force: true });
});

const row = (id: number, role: "user" | "assistant", content: string): ChatTurnRow =>
  ({ id, sessionId: "s", role, content, tokensUsed: 0, ts: id }) as ChatTurnRow;

describe("turnsToChatMessages", () => {
  it("drops shaped assistant row with its user row; keeps alternation", () => {
    const msgs = turnsToChatMessages([
      row(1, "user", "hi"),
      row(2, "assistant", "hello"),
      row(3, "user", "search"),
      row(4, "assistant", SHAPED),
      row(5, "user", "again"),
      row(6, "assistant", "ok"),
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(msgs.some((m) => m.content === SHAPED || m.content === "search")).toBe(false);
  });

  it("leaves legit JSON answers and prose untouched", () => {
    const msgs = turnsToChatMessages([
      row(1, "user", "q"),
      row(2, "assistant", '{"result":180}'),
      row(3, "user", "q2"),
      row(4, "assistant", 'Use {"a":1} in config.'),
    ]);
    expect(msgs).toHaveLength(4);
  });
});

describe("persistTurn", () => {
  it("does not persist a shaped reply; normal replies persist; stored contaminated rows survive", async () => {
    const id = await svc.createSession({ name: "S", agentConfig: { provider: "test", model: "test-model" } });
    const persist = (svc as unknown as { persistTurn: (s: string, u: string, r: string, t: number, tu?: string[]) => void }).persistTurn.bind(svc);
    persist(id, "go", SHAPED, 1);
    expect(getChatTurns(db, id)).toHaveLength(0);
    persist(id, "go", "fine", 1);
    expect(getChatTurns(db, id).map((t) => t.content)).toEqual(["go", "fine"]);
    // pre-existing contaminated rows are not deleted, only hidden from model history
    appendChatTurn(db, { sessionId: id, role: "user", content: "old", tokensUsed: 0 });
    appendChatTurn(db, { sessionId: id, role: "assistant", content: SHAPED, tokensUsed: 0 });
    const stored = getChatTurns(db, id);
    expect(stored).toHaveLength(4);
    expect(turnsToChatMessages(stored).map((m) => m.content)).toEqual(["go", "fine"]);
  });
});
