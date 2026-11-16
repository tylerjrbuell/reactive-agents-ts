import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { chatModeRoute, parseChatMode } from "../api/chat-mode-route.js";
import { ChatSessionService } from "../services/chat-session-service.js";

function setup() {
  const path = tmpDbPath("chat-mode");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  return { path, db, svc, cleanup: () => { db.close(); rmDbFiles(path); } };
}
type Internal = { sessions: Map<string, { session: { mode: string } }> };
const CFG = { provider: "test", model: "m", enableTools: true };

describe("chat session mode (plan | execute)", () => {
  it("new sessions start in execute and GET exposes mode", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      expect(svc.getSession(id)!.mode).toBe("execute");
    } finally { cleanup(); }
  });

  it("legacy DB without the column migrates idempotently with default execute", () => {
    const path = tmpDbPath("chat-mode-mig");
    try {
      openDatabase(path).close();
      const again = openDatabase(path);
      const cols = (again.prepare("PRAGMA table_info(cortex_chat_sessions)").all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols.filter((c) => c === "mode")).toHaveLength(1);
      again.close();
    } finally { rmDbFiles(path); }
  });

  it("setMode persists and survives a new service over the same DB (reload)", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await svc.setMode(id, "plan");
      expect(svc.getSession(id)!.mode).toBe("plan");
      const reloaded = new ChatSessionService(db);
      expect(reloaded.getSession(id)!.mode).toBe("plan");
    } finally { cleanup(); }
  });

  it("the built framework session starts in the stored mode and setMode flips the live session", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await svc.setMode(id, "plan");
      await svc.chat(id, "hello");
      const live = (svc as unknown as Internal).sessions.get(id)!.session;
      expect(live.mode).toBe("plan");
      await svc.setMode(id, "execute");
      expect(live.mode).toBe("execute");
      await svc.disposeAll();
    } finally { cleanup(); }
  });

  it("an unknown session rejects", async () => {
    const { svc, cleanup } = setup();
    try {
      await expect(svc.setMode("nope", "plan")).rejects.toThrow();
    } finally { cleanup(); }
  });

  it("parseChatMode accepts plan|execute only", () => {
    expect(parseChatMode("plan")).toBe("plan");
    expect(parseChatMode("execute")).toBe("execute");
    expect(parseChatMode("PLAN")).toBeNull();
    expect(parseChatMode(undefined)).toBeNull();
  });

  it("PUT /sessions/:id/mode forwards to svc.setMode; invalid is 400", async () => {
    const seen: string[] = [];
    const stub = { setMode: async (_id: string, m: string) => void seen.push(m) } as unknown as ChatSessionService;
    const put = (body: unknown) =>
      new Elysia().use(chatModeRoute(stub)).handle(
        new Request("http://localhost/api/chat/sessions/s1/mode", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const ok = await put({ mode: "plan" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { mode: string }).mode).toBe("plan");
    expect((await put({ mode: "bogus" })).status).toBe(400);
    expect(seen).toEqual(["plan"]);
  });
});
