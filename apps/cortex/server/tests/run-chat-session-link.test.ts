/**
 * Run summaries name the chat session that started the run (`chatSessionId`,
 * `chatSessionName`), so the run view's "Continue in chat" opens that session
 * instead of forking a new one and the Runs table can say "chat" and name it.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applySchema } from "../db/schema.js";
import { getRecentRuns, getRunById, getRunDetail, insertEvent, updateRunStats, upsertRun } from "../db/queries.js";
import { createChatSession, deleteChatSession } from "../db/chat-queries.js";

describe("run -> chat session link", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
  });

  const startChatRoot = (runId: string, sessionId: string) => {
    upsertRun(db, "chat-agent", runId);
    insertEvent(db, { v: 1, agentId: "chat-agent", runId, sessionId, event: { _tag: "AgentStarted", taskId: runId } as never }, 0);
  };

  it("a chat root run carries its session id and name", () => {
    const sessionId = createChatSession(db, { name: "Hash function explainer", agentConfig: { provider: "test" } });
    startChatRoot("root-1", sessionId);
    expect(getRunById(db, "root-1")).toMatchObject({ chatSessionId: sessionId, chatSessionName: "Hash function explainer" });
    expect(getRunDetail(db, "root-1")).toMatchObject({ chatSessionId: sessionId });
    expect(getRecentRuns(db, 10).find((r) => r.runId === "root-1")?.chatSessionId).toBe(sessionId);
  });

  it("a sub-agent run finds the session through its root run", () => {
    const sessionId = createChatSession(db, { name: "Research", agentConfig: { provider: "test" } });
    startChatRoot("root-2", sessionId);
    upsertRun(db, "child-agent", "child-2");
    updateRunStats(db, "child-2", { rootRunId: "root-2" });
    expect(getRunById(db, "child-2")?.chatSessionId).toBe(sessionId);
  });

  it("desk and external runs have no chat session", () => {
    upsertRun(db, "desk-agent", "desk-1");
    insertEvent(db, { v: 1, agentId: "desk-agent", runId: "desk-1", event: { _tag: "AgentStarted", taskId: "desk-1" } as never }, 0);
    const run = getRunById(db, "desk-1");
    expect(run?.chatSessionId).toBeUndefined();
    expect(run?.chatSessionName).toBeUndefined();
  });

  it("a deleted session is not linked (Continue in chat forks a new one)", () => {
    const sessionId = createChatSession(db, { name: "Gone", agentConfig: { provider: "test" } });
    startChatRoot("root-3", sessionId);
    deleteChatSession(db, sessionId);
    expect(getRunById(db, "root-3")?.chatSessionId).toBeUndefined();
  });
});
