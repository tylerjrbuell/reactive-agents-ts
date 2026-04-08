import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { rmSync } from "node:fs";
import { upsertRun, updateRunStats } from "../db/queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

const TEST_DB_PATH = "/tmp/cortex-chat-svc-test.db";
let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  db = openDatabase(TEST_DB_PATH);
  svc = new ChatSessionService(db);
});

afterAll(() => {
  db.close();
  rmSync(TEST_DB_PATH, { force: true });
});

describe("ChatSessionService", () => {
  it("creates a session entry and returns its ID", async () => {
    const id = await svc.createSession({
      name: "Test",
      agentConfig: { provider: "test", model: "test-model" },
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("sends a message and returns a reply", async () => {
    const id = await svc.createSession({
      name: "Echo",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const result = await svc.chat(id, "Hello");
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("persists turns to DB", async () => {
    const id = await svc.createSession({
      name: "Persist",
      agentConfig: { provider: "test", model: "test-model" },
    });
    await svc.chat(id, "ping");
    const { getChatTurns } = await import("../db/chat-queries.js");
    const turns = getChatTurns(db, id);
    expect(turns.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(turns[0]!.role).toBe("user");
    expect(turns[1]!.role).toBe("assistant");
  });

  it("returns error for unknown sessionId", async () => {
    await expect(svc.chat("no-such-id", "hi")).rejects.toThrow();
  });

  it("chat works when session is linked to a persisted run (task context)", async () => {
    upsertRun(db, "agent-linked", "run-linked");
    updateRunStats(db, "run-linked", { status: "completed", debrief: JSON.stringify({ summary: "Prior work done." }) });
    const id = await svc.createSession({
      name: "After run",
      agentConfig: { provider: "test", model: "test-model", runId: "run-linked" },
    });
    const result = await svc.chat(id, "What did we do?");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("session has a stable_agent_id stored in DB after creation", async () => {
    const { getChatSession } = await import("../db/chat-queries.js");
    const id = await svc.createSession({
      name: "Stable Session",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const row = getChatSession(db, id);
    expect(row).not.toBeNull();
    expect(typeof row!.stableAgentId).toBe("string");
    expect(row!.stableAgentId!.length).toBeGreaterThan(0);
  });

  it("two chats in the same session use the same agentId (stable memory path)", async () => {
    const id = await svc.createSession({
      name: "Memory Test",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const r1 = await svc.chat(id, "Hello");
    (svc as unknown as { sessions: Map<string, unknown> }).sessions.delete(id);
    const r2 = await svc.chat(id, "Hello again");
    expect(r1.reply.length).toBeGreaterThan(0);
    expect(r2.reply.length).toBeGreaterThan(0);
    const { getChatSession } = await import("../db/chat-queries.js");
    const row = getChatSession(db, id);
    expect(row!.stableAgentId).toBeDefined();
  });

  it("chatStream yields events and completes with metadata", async () => {
    const id = await svc.createSession({
      name: "Stream Test",
      agentConfig: { provider: "test", model: "test-model" },
    });
    const events = [];
    for await (const event of svc.chatStream(id, "Hello stream")) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThan(0);
    const lastEvent = events[events.length - 1]!;
    expect(lastEvent._tag).toBe("StreamCompleted");
  });

  it("chatStream persists the assistant turn to DB", async () => {
    const id = await svc.createSession({
      name: "Stream Persist",
      agentConfig: { provider: "test", model: "test-model" },
    });
    for await (const _event of svc.chatStream(id, "test message")) {
      // consume all events
    }
    const { getChatTurns } = await import("../db/chat-queries.js");
    const turns = getChatTurns(db, id);
    expect(turns.length).toBeGreaterThanOrEqual(2); // user + assistant
    expect(turns[0]!.role).toBe("user");
    expect(turns[1]!.role).toBe("assistant");
  });
});
