import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { rmSync } from "node:fs";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  appendChatTurn,
  getChatTurns,
  updateSessionLastUsed,
} from "../db/chat-queries.js";

const TEST_DB_PATH = "/tmp/cortex-chat-queries-test.db";
let db: ReturnType<typeof openDatabase>;

beforeAll(() => {
  db = openDatabase(TEST_DB_PATH);
});
afterAll(() => {
  db.close();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("chat sessions", () => {
  it("creates and retrieves a session", () => {
    const id = createChatSession(db, {
      name: "Test Chat",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const session = getChatSession(db, id);
    expect(session).not.toBeNull();
    expect(session!.name).toBe("Test Chat");
    expect(session!.agentConfig.provider).toBe("test");
  });

  it("lists sessions ordered by last_used_at desc", async () => {
    const id1 = createChatSession(db, { name: "A", agentConfig: { provider: "test" } });
    const id2 = createChatSession(db, { name: "B", agentConfig: { provider: "test" } });
    // Avoid same-ms ties with ORDER BY last_used_at DESC
    await new Promise((r) => setTimeout(r, 5));
    updateSessionLastUsed(db, id2);
    const sessions = listChatSessions(db);
    const i2 = sessions.findIndex((s) => s.sessionId === id2);
    const i1 = sessions.findIndex((s) => s.sessionId === id1);
    expect(i2).toBeLessThan(i1);
  });

  it("deletes session and its turns", () => {
    const id = createChatSession(db, { name: "Del", agentConfig: { provider: "test" } });
    appendChatTurn(db, { sessionId: id, role: "user", content: "hello", tokensUsed: 0 });
    deleteChatSession(db, id);
    expect(getChatSession(db, id)).toBeNull();
    expect(getChatTurns(db, id)).toHaveLength(0);
  });
});

describe("chat turns", () => {
  it("appends and retrieves turns in order", () => {
    const id = createChatSession(db, { name: "Turns", agentConfig: { provider: "test" } });
    appendChatTurn(db, { sessionId: id, role: "user", content: "Hi", tokensUsed: 5 });
    appendChatTurn(db, { sessionId: id, role: "assistant", content: "Hello!", tokensUsed: 20 });
    const turns = getChatTurns(db, id);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.role).toBe("user");
    expect(turns[0]!.content).toBe("Hi");
    expect(turns[1]!.role).toBe("assistant");
    expect(turns[1]!.tokensUsed).toBe(20);
  });

  it("persists assistant tool names in tools_json", () => {
    const id = createChatSession(db, { name: "Tools", agentConfig: { provider: "test" } });
    appendChatTurn(db, { sessionId: id, role: "assistant", content: "Done", tokensUsed: 1, toolsUsed: ["web-search"] });
    const turns = getChatTurns(db, id);
    expect(turns[0]!.toolsUsed).toEqual(["web-search"]);
  });
});

describe("stable_agent_id persistence", () => {
  it("stores and retrieves stableAgentId on createChatSession", () => {
    const id = createChatSession(db, {
      name: "Stable ID Test",
      agentConfig: { provider: "test" },
      stableAgentId: "agent-abc-123",
    });
    const session = getChatSession(db, id);
    expect(session).not.toBeNull();
    expect(session!.stableAgentId).toBe("agent-abc-123");
  });

  it("returns undefined stableAgentId when not set", () => {
    const id = createChatSession(db, {
      name: "No ID",
      agentConfig: { provider: "test" },
    });
    const session = getChatSession(db, id);
    expect(session!.stableAgentId).toBeUndefined();
  });

  it("listChatSessions returns stableAgentId for each session", () => {
    const id = createChatSession(db, {
      name: "List Test",
      agentConfig: { provider: "test" },
      stableAgentId: "listed-agent-id",
    });
    const sessions = listChatSessions(db);
    const found = sessions.find((s) => s.sessionId === id);
    expect(found).toBeDefined();
    expect(found!.stableAgentId).toBe("listed-agent-id");
  });
});
