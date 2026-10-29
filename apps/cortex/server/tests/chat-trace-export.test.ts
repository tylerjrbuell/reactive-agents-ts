import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { openDatabase } from "../db/schema.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { chatRouter } from "../api/chat.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { readRunTraceFile, readRunTreeTraces } from "../services/run-trace-file.js";
import { renderChatMarkdown, slugifyFilename } from "../services/chat-export.js";

let traceDir: string;
let prevDir: string | undefined;

beforeEach(() => {
  traceDir = mkdtempSync(join(tmpdir(), "cortex-chat-trace-"));
  prevDir = process.env.CORTEX_TRACE_DIR;
  process.env.CORTEX_TRACE_DIR = traceDir;
});
afterEach(() => {
  if (prevDir === undefined) delete process.env.CORTEX_TRACE_DIR;
  else process.env.CORTEX_TRACE_DIR = prevDir;
  rmSync(traceDir, { recursive: true, force: true });
});

function setup() {
  const path = `/tmp/cortex-chat-trace-export-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  const app = new Elysia().use(chatRouter(svc));
  const get = (url: string) => app.handle(new Request(`http://localhost${url}`));
  return {
    db,
    svc,
    get,
    cleanup: async () => {
      await svc.disposeAll();
      db.close();
      rmSync(path, { force: true });
    },
  };
}

const ev = (runId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: "run-started", runId, rootRunId: runId, timestamp: 1, iter: -1, seq: 0, ...extra });

/** Seed a session with one persisted exchange; returns the assistant turn id. */
function seed(db: ReturnType<typeof openDatabase>, runId?: string) {
  const sessionId = createChatSession(db, { name: "My Chat: /v2?", agentConfig: { provider: "test", model: "m" } });
  appendChatTurn(db, { sessionId, role: "user", content: "hello", tokensUsed: 0 });
  appendChatTurn(db, {
    sessionId,
    role: "assistant",
    content: "hi there",
    tokensUsed: 12,
    provider: "test",
    model: "m",
    costUsd: 0.0042,
    ...(runId ? { runId } : {}),
  });
  const turnId = getChatTurns(db, sessionId).find((t) => t.role === "assistant")!.id;
  return { sessionId, turnId };
}

describe("run id persistence", () => {
  it("a streamed turn persists run_id equal to the tracer's file name", async () => {
    const { db, svc, get, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true } });
      for await (const _ of svc.chatStream(id, "say hi")) void _;
      const assistant = getChatTurns(db, id).find((t) => t.role === "assistant")!;
      expect(assistant.runId).toBeTruthy();
      // The recorder flushes asynchronously after the run; wait for the file to land.
      const file = `${assistant.runId}.jsonl`;
      for (let i = 0; i < 40 && !readdirSync(traceDir).includes(file); i++) await Bun.sleep(50);
      expect(readdirSync(traceDir)).toContain(file);
      const res = await get(`/api/chat/sessions/${id}/turns/${assistant.id}/trace`);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-trace-source")).toBe("tracer");
      expect(res.headers.get("content-type")).toContain("application/x-ndjson");
      expect((await res.text()).length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });

  it("traceRuns:false builds the session without a chat-owned tracer dir", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({
        agentConfig: { provider: "test", model: "test-model", enableTools: true, traceRuns: false },
      });
      for await (const _ of svc.chatStream(id, "say hi")) void _;
      expect(readdirSync(traceDir).filter((f) => !f.startsWith("llm-direct"))).toEqual([]);
      expect(db).toBeTruthy();
    } finally {
      await cleanup();
    }
  });
});

describe("GET /sessions/:id/turns/:turnId/trace", () => {
  it("returns the root trace then each descendant (found via rootRunId) by start time", async () => {
    const { db, get, cleanup } = setup();
    try {
      const { sessionId, turnId } = seed(db, "ROOT1");
      writeFileSync(join(traceDir, "ROOT1.jsonl"), ev("ROOT1", { timestamp: 100 }) + "\n");
      writeFileSync(join(traceDir, "KIDB.jsonl"), ev("KIDB", { rootRunId: "ROOT1", parentRunId: "ROOT1", depth: 1, timestamp: 300 }) + "\n");
      writeFileSync(join(traceDir, "KIDA.jsonl"), ev("KIDA", { rootRunId: "ROOT1", parentRunId: "ROOT1", depth: 1, timestamp: 200 }) + "\n");
      writeFileSync(join(traceDir, "OTHER.jsonl"), ev("OTHER", { rootRunId: "SOMEONE", timestamp: 150 }) + "\n");
      const res = await get(`/api/chat/sessions/${sessionId}/turns/${turnId}/trace`);
      expect(res.status).toBe(200);
      const runIds = (await res.text()).trim().split("\n").map((l) => (JSON.parse(l) as { runId: string }).runId);
      expect(runIds).toEqual(["ROOT1", "KIDA", "KIDB"]);
    } finally {
      await cleanup();
    }
  });

  it("404s when the turn has no run id, the file is missing, or the turn is unknown", async () => {
    const { db, get, cleanup } = setup();
    try {
      const noRun = seed(db);
      expect((await get(`/api/chat/sessions/${noRun.sessionId}/turns/${noRun.turnId}/trace`)).status).toBe(404);
      const missing = seed(db, "GONE");
      expect((await get(`/api/chat/sessions/${missing.sessionId}/turns/${missing.turnId}/trace`)).status).toBe(404);
      expect((await get(`/api/chat/sessions/${missing.sessionId}/turns/99999/trace`)).status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("never builds a path from a malformed run id", async () => {
    const { db, get, cleanup } = setup();
    try {
      mkdirSync(join(traceDir, "sub"));
      const { sessionId, turnId } = seed(db, "../../etc/passwd");
      expect((await get(`/api/chat/sessions/${sessionId}/turns/${turnId}/trace`)).status).toBe(404);
      expect(readRunTraceFile("../x", [traceDir])).toBeUndefined();
      expect(readRunTreeTraces("../x", [traceDir])).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});

describe("GET /sessions/:id/export", () => {
  it("md is a readable transcript in order with model and cost, and a safe filename", async () => {
    const { db, get, cleanup } = setup();
    try {
      const { sessionId } = seed(db, "R");
      const res = await get(`/api/chat/sessions/${sessionId}/export?format=md`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="my-chat-v2.md"');
      const md = await res.text();
      expect(md.indexOf("hello")).toBeGreaterThan(-1);
      expect(md.indexOf("hi there")).toBeGreaterThan(md.indexOf("hello"));
      expect(md).toContain("test/m");
      expect(md).toContain("$0.0042");
    } finally {
      await cleanup();
    }
  });

  it("json is session + turns + traces; format defaults to md; bad format is 400", async () => {
    const { db, get, cleanup } = setup();
    try {
      const { sessionId, turnId } = seed(db, "ROOT2");
      writeFileSync(join(traceDir, "ROOT2.jsonl"), ev("ROOT2") + "\n");
      const body = (await (await get(`/api/chat/sessions/${sessionId}/export?format=json`)).json()) as {
        session: { sessionId: string };
        turns: unknown[];
        traces: Record<string, string>;
      };
      expect(body.session.sessionId).toBe(sessionId);
      expect(body.turns).toHaveLength(2);
      expect(Object.keys(body.traces)).toEqual([String(turnId)]);
      expect(body.traces[String(turnId)]).toContain("ROOT2");
      expect((await get(`/api/chat/sessions/${sessionId}/export`)).headers.get("content-type")).toContain("text/markdown");
      expect((await get(`/api/chat/sessions/${sessionId}/export?format=xml`)).status).toBe(400);
      expect((await get(`/api/chat/sessions/nope/export?format=md`)).status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("jsonl: every line parses and carries a turnId", async () => {
    const { db, get, cleanup } = setup();
    try {
      const { sessionId, turnId } = seed(db, "ROOT3");
      writeFileSync(join(traceDir, "ROOT3.jsonl"), `${ev("ROOT3")}\n${ev("ROOT3", { seq: 1 })}\n`);
      const res = await get(`/api/chat/sessions/${sessionId}/export?format=jsonl`);
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="my-chat-v2.jsonl"');
      const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l) as { turnId: number });
      expect(lines).toHaveLength(2);
      expect(lines.every((l) => l.turnId === turnId)).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

describe("helpers", () => {
  it("slugifyFilename is a safe slug with a fallback", () => {
    expect(slugifyFilename('A/B\\C "x" ../..')).toBe("a-b-c-x");
    expect(slugifyFilename("   ")).toBe("chat");
    expect(slugifyFilename("é日本")).toBe("chat");
  });

  it("renderChatMarkdown lists tool calls from the stored trace", () => {
    const md = renderChatMarkdown(
      { name: "n" },
      [
        { id: 1, sessionId: "s", role: "user", content: "q", tokensUsed: 0, costUsd: 0, costKnown: true, ts: 0 },
        {
          id: 2, sessionId: "s", role: "assistant", content: "a", tokensUsed: 3, costUsd: 0, costKnown: false, ts: 0,
          trace: { reasoningSteps: [], toolCalls: [{ id: "c", name: "web-search", status: "done", iteration: 1 }] },
        },
      ],
    );
    expect(md).toContain("web-search");
    expect(md).toContain("cost unknown");
  });

  it("renderChatMarkdown never prints a sub-cent known cost as zero", () => {
    const md = renderChatMarkdown(
      { name: "n" },
      [{ id: 2, sessionId: "s", role: "assistant", content: "a", tokensUsed: 3, costUsd: 0.00000795, costKnown: true, ts: 0 }],
    );
    expect(md).toContain("<$0.0001");
    expect(md).not.toContain("$0.0000");
  });
});
