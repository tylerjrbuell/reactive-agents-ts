import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { rmSync } from "node:fs";
import { openDatabase } from "../db/schema.js";
import { getChatTurns } from "../db/chat-queries.js";
import { chatRouter } from "../api/chat.js";
import { defaultConfig } from "../../ui/src/lib/types/agent-config.js";
import { cortexRunsPostBody } from "../../ui/src/lib/cortex-runs-post-body.js";
import { ChatSessionBusyError, ChatSessionService } from "../services/chat-session-service.js";

function setup(opts?: { maxCachedSessions?: number }) {
  const path = `/tmp/cortex-chat-lifecycle-${crypto.randomUUID()}.db`;
  const db = openDatabase(path);
  const svc = new ChatSessionService(db, opts);
  const cleanup = () => {
    db.close();
    rmSync(path, { force: true });
  };
  return { db, svc, cleanup };
}

const cfg = { provider: "test", model: "test-model" };

describe("chat session lifecycle", () => {
  it("API keeps skills.activate on session create (not stripped by body validation)", async () => {
    let got: { agentConfig: Record<string, unknown> } | undefined;
    const svc = {
      createSession: async (o: { agentConfig: Record<string, unknown> }) => {
        got = o;
        return "id";
      },
    } as unknown as ChatSessionService;
    const app = new Elysia().use(chatRouter(svc));
    const res = await app.handle(
      new Request("http://localhost/api/chat/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "test", skills: { paths: ["/a"], activate: ["forced"] } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(got?.agentConfig.skills).toEqual({ paths: ["/a"], activate: ["forced"] });
  });

  it("the Lab panel's default config (as the chat UI sends it) is accepted by session create", async () => {
    const svc = { createSession: async () => "id" } as unknown as ChatSessionService;
    const app = new Elysia().use(chatRouter(svc));
    const { prompt: _prompt, ...typed } = cortexRunsPostBody("", defaultConfig());
    const res = await app.handle(
      new Request("http://localhost/api/chat/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...typed, enableTools: false, streamReasoningSteps: false }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it("a completed turn persists the user+assistant pair together", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      await svc.chat(id, "hello");
      const turns = getChatTurns(db, id);
      expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("a failed turn leaves no orphan user row", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      await svc.chat(id, "first");
      const internal = svc as unknown as {
        sessions: Map<string, { session: { chat: () => Promise<never> } }>;
      };
      internal.sessions.get(id)!.session.chat = () => Promise.reject(new Error("boom"));
      await expect(svc.chat(id, "doomed")).rejects.toThrow("boom");
      const turns = getChatTurns(db, id);
      expect(turns.map((t) => t.content)).not.toContain("doomed");
      expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("rejects a concurrent turn on the same session with ChatSessionBusyError", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: cfg });
      const first = svc.chat(id, "one");
      await expect(svc.chat(id, "two")).rejects.toBeInstanceOf(ChatSessionBusyError);
      await first;
      await svc.chat(id, "three"); // slot released
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("builds one agent when two first turns race (single-flight)", async () => {
    const { svc, cleanup } = setup();
    try {
      const a = await svc.createSession({ agentConfig: cfg });
      const internal = svc as unknown as {
        getOrBuildSession: (id: string, c: Record<string, unknown>, s: undefined) => Promise<unknown>;
      };
      const [x, y] = await Promise.all([
        internal.getOrBuildSession(a, cfg, undefined),
        internal.getOrBuildSession(a, cfg, undefined),
      ]);
      expect(x).toBe(y);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });

  it("evicts least-recently-used sessions beyond the cap", async () => {
    const { svc, cleanup } = setup({ maxCachedSessions: 2 });
    try {
      const ids = [
        await svc.createSession({ agentConfig: cfg }),
        await svc.createSession({ agentConfig: cfg }),
        await svc.createSession({ agentConfig: cfg }),
      ];
      for (const id of ids) await svc.chat(id, "hi");
      const cached = (svc as unknown as { sessions: Map<string, unknown> }).sessions;
      expect([...cached.keys()]).toEqual([ids[1]!, ids[2]!]);
      await svc.disposeAll();
    } finally {
      cleanup();
    }
  });
});
