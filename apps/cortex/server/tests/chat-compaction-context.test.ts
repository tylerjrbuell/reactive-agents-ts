import { describe, expect, it } from "bun:test";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, getChatTurns, type StoredContext } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { COMPACTION_SECTIONS, UNSTRUCTURED_SUMMARY_HEADING } from "../services/compaction-summary.js";

const STRUCTURED = COMPACTION_SECTIONS.map((s) => `## ${s}\nNone.`).join("\n\n");

function setup(summary: string) {
  const path = tmpDbPath("compact-ctx");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db, { summarize: async () => summary });
  return { db, svc, cleanup: () => (db.close(), rmDbFiles(path)) };
}

/** Three exchanges; the assistant reply of each carries a reading when `window` is given. */
async function seeded(svc: ChatSessionService, db: ReturnType<typeof openDatabase>, window?: number) {
  const sessionId = await svc.createSession({ agentConfig: { provider: "test", model: "m" }, name: "Src" });
  for (let i = 1; i <= 3; i++) {
    appendChatTurn(db, { sessionId, role: "user", content: `question ${i} ` + "p".repeat(300), tokensUsed: 0 });
    const context: StoredContext | undefined =
      window === undefined ? undefined : { tokensUsed: 4000 + i, windowTokens: window, utilizationPct: 50, level: "medium" };
    appendChatTurn(db, { sessionId, role: "assistant", content: `answer ${i} ` + "a".repeat(300), tokensUsed: 3, ...(context ? { context } : {}) });
  }
  return sessionId;
}

describe("compaction carries a fresh context estimate", () => {
  it("returns the estimate and persists it on the summary row, with stale readings cleared from kept rows", async () => {
    const { db, svc, cleanup } = setup(STRUCTURED);
    try {
      const id = await seeded(svc, db, 8000);
      const out = await svc.compact(id, { keepLast: 1 });
      expect(out.context?.estimated).toBe(true);
      expect(out.context?.tokensUsed).toBeGreaterThan(0);
      expect(out.context?.windowTokens).toBe(8000);
      expect(out.context?.utilizationPct).toBe(Math.round(((out.context?.tokensUsed ?? 0) / 8000) * 100));

      const turns = getChatTurns(db, id);
      // marker, summary, kept question, kept answer
      expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
      expect(turns[1]?.context).toEqual(out.context);
      expect(turns[2]?.context).toBeUndefined();
      expect(turns[3]?.context).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("estimates without a window when the session has no prior reading (tokens only)", async () => {
    const { db, svc, cleanup } = setup(STRUCTURED);
    try {
      const id = await seeded(svc, db, undefined);
      const out = await svc.compact(id, { keepLast: 1 });
      expect(out.context?.estimated).toBe(true);
      expect(out.context?.tokensUsed).toBeGreaterThan(0);
      expect(out.context?.windowTokens).toBeUndefined();
      expect(out.context?.utilizationPct).toBeUndefined();
      expect(getChatTurns(db, id)[1]?.context?.tokensUsed).toBe(out.context?.tokensUsed);
    } finally {
      cleanup();
    }
  });
});

describe("compaction summary structure", () => {
  it("keeps a structured summary as returned", async () => {
    const { db, svc, cleanup } = setup(STRUCTURED);
    try {
      const id = await seeded(svc, db, 8000);
      const out = await svc.compact(id, { keepLast: 1 });
      expect(out.summary).toBe(STRUCTURED);
      expect(getChatTurns(db, id)[1]?.content).toBe(STRUCTURED);
    } finally {
      cleanup();
    }
  });

  it("wraps an unstructured summary under the fallback heading instead of failing", async () => {
    const { db, svc, cleanup } = setup("They discussed the importer.");
    try {
      const id = await seeded(svc, db, 8000);
      const out = await svc.compact(id, { keepLast: 1 });
      expect(out.summary).toBe(`${UNSTRUCTURED_SUMMARY_HEADING}\n\nThey discussed the importer.`);
      expect(getChatTurns(db, id)[1]?.content).toBe(out.summary);
    } finally {
      cleanup();
    }
  });

  it("still refuses an empty summary and leaves history unchanged", async () => {
    const { db, svc, cleanup } = setup("   ");
    try {
      const id = await seeded(svc, db, 8000);
      const before = getChatTurns(db, id).length;
      await expect(svc.compact(id, { keepLast: 1 })).rejects.toThrow("History is unchanged");
      expect(getChatTurns(db, id).length).toBe(before);
    } finally {
      cleanup();
    }
  });
});
