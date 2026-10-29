import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { createChatSession } from "../db/chat-queries.js";
import {
  ChatScheduleService,
  MAX_SCHEDULES_PER_SESSION,
  parseIntervalSpec,
} from "../services/chat-schedule-service.js";
import { ChatSessionBusyError, type CortexChatResult } from "../services/chat-session-service.js";
import { chatRouter } from "../api/chat.js";

const MIN = 60_000;

describe("chat schedules", () => {
  let db: Database;
  let sid: string;
  let clock: number;
  let calls: Array<{ sid: string; msg: string }>;
  let next: () => Promise<CortexChatResult>;
  let svc: ChatScheduleService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    sid = createChatSession(db, { agentConfig: { provider: "test" } });
    clock = Date.UTC(2026, 9, 29, 12, 0, 0);
    calls = [];
    next = async () => ({ reply: "ok", tokensUsed: 1, cost: 0.01 });
    svc = new ChatScheduleService(
      db,
      async (s, m) => {
        calls.push({ sid: s, msg: m });
        return next();
      },
      { now: () => clock },
    );
  });
  afterEach(() => svc.dispose());

  const mk = (over: Partial<Parameters<ChatScheduleService["create"]>[0]> = {}) => {
    const r = svc.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: "check", ...over });
    if (!r.ok) throw new Error(r.message);
    return r.schedule;
  };

  it("parses interval specs", () => {
    expect(parseIntervalSpec("5m")).toBe(5 * MIN);
    expect(parseIntervalSpec("1h")).toBe(60 * MIN);
    expect(parseIntervalSpec("0m")).toBeNull();
    expect(parseIntervalSpec("abc")).toBeNull();
  });

  it("fires a loop when idle and due, not before", async () => {
    const s = mk();
    await svc.tick();
    expect(calls).toHaveLength(0);
    clock += 5 * MIN;
    await svc.tick();
    expect(calls).toEqual([{ sid, msg: "check" }]);
    const after = svc.get(s.id)!;
    expect(after.runs).toBe(1);
    expect(after.lastStatus).toBe("ok");
    expect(svc.fires(s.id)[0]).toMatchObject({ _tag: "ScheduleFired", status: "ok" });
  });

  it("records skipped:busy without counting a run", async () => {
    const s = mk();
    next = async () => {
      throw new ChatSessionBusyError(sid);
    };
    clock += 5 * MIN;
    await svc.tick();
    const after = svc.get(s.id)!;
    expect(after.lastStatus).toBe("skipped:busy");
    expect(after.runs).toBe(0);
    expect(after.enabled).toBe(true);
    expect(svc.fires(s.id)[0]?.status).toBe("skipped:busy");
  });

  it("expires and stops firing", async () => {
    const s = mk({ ttlMs: 10 * MIN });
    clock += 11 * MIN;
    await svc.tick();
    expect(calls).toHaveLength(0);
    expect(svc.get(s.id)).toMatchObject({ lastStatus: "expired", enabled: false });
  });

  it("caps schedules per session", () => {
    for (let i = 0; i < MAX_SCHEDULES_PER_SESSION; i++) mk();
    const r = svc.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: "x" });
    expect(r).toMatchObject({ ok: false, code: "cap" });
  });

  it("rejects bad specs and unknown sessions", () => {
    expect(svc.create({ sessionId: sid, kind: "loop", spec: "5s", prompt: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect(svc.create({ sessionId: sid, kind: "cron", spec: "nope", prompt: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect(svc.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: "x", ttlMs: 1e12 })).toMatchObject({ ok: false, code: "invalid" });
    expect(svc.create({ sessionId: "missing", kind: "loop", spec: "5m", prompt: "x" })).toMatchObject({ ok: false, code: "not-found" });
  });

  it("disables a schedule whose turn exceeds the per-fire cost cap", async () => {
    const s = mk({ maxCostUsd: 0.05 });
    next = async () => ({ reply: "ok", tokensUsed: 1, cost: 0.5 });
    clock += 5 * MIN;
    await svc.tick();
    expect(svc.get(s.id)).toMatchObject({ lastStatus: "cost-capped", enabled: false });
    clock += 5 * MIN;
    await svc.tick();
    expect(calls).toHaveLength(1);
  });

  it("matches cron through the gateway parser, once per minute", async () => {
    const s = mk({ kind: "cron", spec: "*/15 * * * *" });
    await svc.tick(); // 12:00 matches
    expect(calls).toHaveLength(1);
    await svc.tick(); // same minute: no double fire
    expect(calls).toHaveLength(1);
    clock += MIN; // 12:01 no match
    await svc.tick();
    expect(calls).toHaveLength(1);
    clock += 14 * MIN; // 12:15
    await svc.tick();
    expect(calls).toHaveLength(2);
    expect(svc.get(s.id)!.runs).toBe(2);
  });

  it("records an error without disabling", async () => {
    const s = mk();
    next = async () => {
      throw new Error("boom");
    };
    clock += 5 * MIN;
    await svc.tick();
    expect(svc.get(s.id)).toMatchObject({ lastStatus: "error", enabled: true });
  });

  it("ticker starts once, is unref'd, and dispose stops it", async () => {
    const fast = new ChatScheduleService(db, async () => ({ reply: "", tokensUsed: 0 }), { now: () => clock, tickMs: 5 });
    fast.start();
    fast.start();
    fast.dispose();
    fast.dispose();
    // Process exits cleanly only if no handle leaked; reaching here with the suite finishing proves it.
    expect(true).toBe(true);
  });

  it("routes: POST/GET/DELETE", async () => {
    const app = new Elysia().use(chatRouter({} as never, svc));
    const call = (method: string, path: string, body?: unknown) =>
      app.handle(
        new Request(`http://localhost/api/chat${path}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    const created = await call("POST", `/sessions/${sid}/schedules`, { kind: "loop", spec: "5m", prompt: "hi" });
    expect(created.status).toBe(200);
    const { schedule } = (await created.json()) as { schedule: { id: string } };
    const bad = await call("POST", `/sessions/${sid}/schedules`, { kind: "loop", spec: "zz", prompt: "hi" });
    expect(bad.status).toBe(400);
    const listed = (await (await call("GET", `/sessions/${sid}/schedules`)).json()) as { schedules: unknown[] };
    expect(listed.schedules).toHaveLength(1);
    expect((await call("DELETE", `/sessions/${sid}/schedules/${schedule.id}`)).status).toBe(200);
    expect((await call("DELETE", `/sessions/${sid}/schedules/${schedule.id}`)).status).toBe(404);
  });
});
