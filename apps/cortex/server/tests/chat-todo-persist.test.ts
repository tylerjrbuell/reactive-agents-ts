import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import type { TodoSeedItem } from "@reactive-agents/runtime";

function setup() {
  const path = `/tmp/cortex-chat-todo-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return { db, svc, cleanup: () => { db.close(); rmSync(path, { force: true }); } };
}
type FakeEvent = Record<string, unknown>;
type Internal = { sessions: Map<string, { session: { runStream: unknown; todo: () => readonly TodoSeedItem[] } }> };

const LIST: TodoSeedItem[] = [
  { id: "1", title: "step one", status: "completed" },
  { id: "2", title: "step two", status: "pending" },
];

/** Replace the cached session's stream with a scripted turn that "leaves" `todo` behind. */
function scriptTurn(svc: ChatSessionService, id: string, todo: readonly TodoSeedItem[]): void {
  const s = (svc as unknown as Internal).sessions.get(id)!.session;
  s.runStream = async function* (): AsyncGenerator<FakeEvent> {
    yield { _tag: "TextDelta", text: "ok" };
    yield { _tag: "StreamCompleted", output: "ok", metadata: { tokensUsed: 1, cost: 0, stepsCount: 1, duration: 1 } };
  };
  s.todo = () => todo;
}

const drain = async (svc: ChatSessionService, id: string, msg: string): Promise<void> => {
  for await (const e of svc.chatStream(id, msg)) void e;
};

describe("conversation to-do persistence", () => {
  it("legacy / new sessions have an empty list", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      expect(svc.getSession(id)!.todo).toEqual([]);
    } finally { cleanup(); }
  });

  it("legacy DB without the column migrates idempotently", () => {
    const path = `/tmp/cortex-chat-todo-mig-${crypto.randomUUID()}.db`;
    try {
      const db = openDatabase(path);
      db.close();
      const again = openDatabase(path);
      const cols = (again.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols.filter((c) => c === "todo_json")).toHaveLength(1);
      again.close();
    } finally { rmSync(path, { force: true }); }
  });

  it("a completed streamed turn persists session.todo() and GET exposes it", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await svc.chat(id, "warm");
      scriptTurn(svc, id, LIST);
      await drain(svc, id, "plan");
      expect(svc.getSession(id)!.todo).toEqual(LIST);
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("a rebuilt session (after eviction/restart) is seeded from the persisted list", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await svc.chat(id, "warm");
      scriptTurn(svc, id, LIST);
      await drain(svc, id, "plan");
      await svc.disposeAll();
      await svc.chat(id, "next"); // rebuilds from DB
      expect((svc as unknown as Internal).sessions.get(id)!.session.todo()).toEqual(LIST);
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("an edit replaces the list, evicts the cached engine, and seeds the next turn", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m", enableTools: true } });
      await svc.chat(id, "warm");
      scriptTurn(svc, id, LIST);
      await drain(svc, id, "plan");
      const edited: TodoSeedItem[] = [
        { id: "1", title: "step one", status: "completed" },
        { id: "2", title: "step two", status: "completed" },
        { id: "3", title: "added", status: "pending" },
      ];
      await svc.setTodo(id, edited);
      expect(svc.getSession(id)!.todo).toEqual(edited);
      expect((svc as unknown as Internal).sessions.has(id)).toBe(false);
      await svc.chat(id, "go");
      expect((svc as unknown as Internal).sessions.get(id)!.session.todo()).toEqual(edited);
      await svc.setTodo(id, []);
      expect(svc.getSession(id)!.todo).toEqual([]);
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("rejects malformed lists", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m" } });
      const bad: unknown[] = [
        [{ id: "1", title: "", status: "pending" }],
        [{ id: "1", title: "a", status: "nope" }],
        [{ id: "1", title: "a", status: "pending" }, { id: "1", title: "b", status: "pending" }],
        [{ id: "", title: "a", status: "pending" }],
      ];
      for (const b of bad) await expect(svc.setTodo(id, b as TodoSeedItem[])).rejects.toThrow(/invalid to-do/i);
      expect(svc.getSession(id)!.todo).toEqual([]);
    } finally { cleanup(); }
  });

  it("clear empties the list; fork copies it", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m" } });
      await svc.setTodo(id, LIST);
      const fork = await svc.fork(id);
      expect(svc.getSession(fork)!.todo).toEqual(LIST);
      await svc.clear(id);
      expect(svc.getSession(id)!.todo).toEqual([]);
    } finally { cleanup(); }
  });
});
