import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, getChatTurns, COMPACTED_USER_MARKER } from "../db/chat-queries.js";
import { chatRouter } from "../api/chat.js";
import { ChatSessionBusyError, ChatSessionService } from "../services/chat-session-service.js";

function setup() {
  const path = `/tmp/cortex-chat-utils-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const summaries: string[][] = [];
  const svc = new ChatSessionService(db, {
    summarize: async (turns) => {
      summaries.push(turns.map((t) => t.content));
      return "SUMMARY";
    },
  });
  return { db, svc, summaries, cleanup: () => (db.close(), rmSync(path, { force: true })) };
}

async function seeded(svc: ChatSessionService, db: ReturnType<typeof openDatabase>, exchanges: number) {
  const sessionId = await svc.createSession({ agentConfig: { provider: "test", model: "m" }, name: "Src" });
  for (let i = 1; i <= exchanges; i++) {
    appendChatTurn(db, { sessionId, role: "user", content: `q${i}`, tokensUsed: 0 });
    appendChatTurn(db, {
      sessionId,
      role: "assistant",
      content: `a${i}`,
      tokensUsed: 3,
      trace: { reasoningSteps: [{ iteration: 1, thought: `t${i}` }], toolCalls: [] },
    });
  }
  return sessionId;
}

const contents = (db: ReturnType<typeof openDatabase>, id: string) => getChatTurns(db, id).map((t) => t.content);

describe("per-turn model attribution", () => {
  it("stores the producing provider/model on assistant turns and keeps it through fork", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "m" }, name: "Src" });
      appendChatTurn(db, { sessionId: id, role: "user", content: "q", tokensUsed: 0 });
      appendChatTurn(db, { sessionId: id, role: "assistant", content: "a", tokensUsed: 1, provider: "ollama", model: "nimble:latest" });
      const [user, asst] = getChatTurns(db, id);
      expect(user).not.toHaveProperty("model");
      expect(asst).toMatchObject({ provider: "ollama", model: "nimble:latest" });
      const forkId = await svc.fork(id, {});
      expect(getChatTurns(db, forkId)[1]).toMatchObject({ provider: "ollama", model: "nimble:latest" });
    } finally {
      cleanup();
    }
  });
});

describe("editing a compaction summary", () => {
  it("rewrites only the summary row; ordinary answers are refused", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 3);
      await svc.compact(id, { keepLast: 1 });
      const turns = getChatTurns(db, id);
      const summary = turns.find((t) => t.content === "SUMMARY")!;
      await svc.editSummary(id, summary.id, "  My own recap  ");
      expect(getChatTurns(db, id).find((t) => t.id === summary.id)!.content).toBe("My own recap");
      const answer = getChatTurns(db, id).find((t) => t.content === "a3")!;
      await expect(svc.editSummary(id, answer.id, "hijack")).rejects.toThrow("not found");
      await expect(svc.editSummary(id, summary.id, "   ")).rejects.toThrow("empty");
    } finally {
      cleanup();
    }
  });
});

describe("chat utilities", () => {
  it("rewind removes the exchange and everything after; assistant id rewinds to its prompt; returns the user text", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 3);
      const turns = getChatTurns(db, id);
      const out = await svc.rewind(id, turns[3]!.id); // assistant a2
      expect(out.userMessage).toBe("q2");
      expect(contents(db, id)).toEqual(["q1", "a1"]);
    } finally {
      cleanup();
    }
  });

  it("clear empties the conversation but keeps the session", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 2);
      expect((await svc.clear(id)).removed).toBe(4);
      expect(svc.getSession(id)?.turns).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("fork copies history (with traces) up to the turn into a NEW session; source untouched", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 3);
      const turns = getChatTurns(db, id);
      const forkId = await svc.fork(id, { atTurnId: turns[2]!.id }); // user q2 → includes a2
      expect(forkId).not.toBe(id);
      expect(contents(db, forkId)).toEqual(["q1", "a1", "q2", "a2"]);
      expect(getChatTurns(db, forkId)[1]!.trace?.reasoningSteps[0]?.thought).toBe("t1");
      expect(contents(db, id).length).toBe(6);
      expect(svc.getSession(forkId)?.name).toBe("Src (fork)");
    } finally {
      cleanup();
    }
  });

  it("compact collapses the old prefix into one summary exchange and keeps the last N exchanges", async () => {
    const { svc, db, summaries, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 4);
      const out = await svc.compact(id, { keepLast: 1 });
      expect(summaries[0]).toEqual(["q1", "a1", "q2", "a2", "q3", "a3"]);
      expect(out.summary).toBe("SUMMARY");
      expect(contents(db, id)).toEqual([COMPACTED_USER_MARKER, "SUMMARY", "q4", "a4"]);
      // nothing left to compact → no summarizer call
      expect((await svc.compact(id, { keepLast: 1 })).collapsed).toBe(0);
      expect(summaries.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("default compact works on a 2-exchange chat (keeps the last exchange, summarises the first)", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 2);
      const out = await svc.compact(id);
      expect(out.compacted).toBe(2);
      expect(contents(db, id)).toEqual([COMPACTED_USER_MARKER, "SUMMARY", "q2", "a2"]);
      // a single exchange has nothing to compact
      const one = await seeded(svc, db, 1);
      expect((await svc.compact(one)).compacted).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("clear rotates the agent identity so memory keyed on it starts fresh", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 1);
      const before = svc.getSession(id)?.stableAgentId;
      await svc.clear(id);
      const after = svc.getSession(id)?.stableAgentId;
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
    } finally {
      cleanup();
    }
  });

  it("mutations are refused while a turn is in flight", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const id = await seeded(svc, db, 1);
      (svc as unknown as { inFlight: Set<string> }).inFlight.add(id);
      await expect(svc.clear(id)).rejects.toBeInstanceOf(ChatSessionBusyError);
    } finally {
      cleanup();
    }
  });

  it("routes: rewind / fork / clear / compact; unknown ids 404, busy 409", async () => {
    const { svc, db, cleanup } = setup();
    try {
      const app = new Elysia().use(chatRouter(svc));
      const id = await seeded(svc, db, 2);
      const post = (path: string, body?: unknown) =>
        app.handle(new Request(`http://localhost/api/chat/sessions/${id}/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        }));
      const turns = getChatTurns(db, id);
      expect((await post("fork", { atTurnId: turns[1]!.id })).status).toBe(200);
      expect((await post("rewind", { turnId: 999999 })).status).toBe(404);
      expect((await post("compact", { keepLast: 1 })).status).toBe(200);
      expect((await post("clear")).status).toBe(200);
      (svc as unknown as { inFlight: Set<string> }).inFlight.add(id);
      expect((await post("clear")).status).toBe(409);
    } finally {
      cleanup();
    }
  });
});
