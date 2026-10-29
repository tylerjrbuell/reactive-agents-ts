import { describe, expect, test } from "bun:test";
import { createChatGoalStore } from "./chat-goal.js";
import { runGoalSlash, type GoalNotify } from "../chat-goal-commands.js";
import type { GoalWire } from "../goal-view.js";

const G: GoalWire = {
  id: "g", objective: "o", criteria: [], budget: { maxSegments: 3 }, status: "proposed",
  segments: 0, spent: { costUsd: 0, tokens: 0, wallClockMs: 0 }, verdictHistory: [],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mock(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return handler(u, init);
  });
  return { f, calls };
}
const notes = () => {
  const log: string[] = [];
  const n: GoalNotify = { ok: (t) => log.push(`ok:${t}`), info: (t) => log.push(`info:${t}`), err: (t, d) => log.push(`err:${t}:${d}`) };
  return { n, log };
};

describe("chat goal store", () => {
  test("propose then accept", async () => {
    const { f, calls } = mock((u) => json(u.endsWith("/goal/accept") ? { ...G, status: "active" } : G));
    const store = createChatGoalStore(f);
    store.reset("s1");
    await store.propose("s1", "ship");
    expect(calls[0]).toMatchObject({ method: "POST", body: { objective: "ship" } });
    expect(store.snapshot().goal?.status).toBe("proposed");
    await store.transition("s1", "accept");
    expect(calls[1]?.url).toContain("/api/chat/sessions/s1/goal/accept");
    expect(store.snapshot().goal?.status).toBe("active");
  });
  test("a late response for another session is ignored", async () => {
    const { f } = mock(() => json({ goal: G }));
    const store = createChatGoalStore(f);
    store.reset("s1");
    const p = store.loadGoal("s1");
    store.reset("s2");
    await p;
    expect(store.snapshot().goal).toBeNull();
  });
  test("server error message surfaces; 409 busy toast", async () => {
    const { f } = mock(() => json({ error: "Goal active: pause it first" }, 409));
    const store = createChatGoalStore(f);
    store.reset("s1");
    const { n, log } = notes();
    await runGoalSlash("goal", "do it", "s1", store, n);
    expect(log).toEqual(["err:/goal failed:Goal active: pause it first"]);
  });
  test("/loop starts and /loop stop removes only loops", async () => {
    const sched = [
      { id: "a", kind: "loop", spec: "5m", prompt: "p", expiresAt: 0, runs: 0, lastStatus: null },
      { id: "b", kind: "cron", spec: "0 9 * * *", prompt: "q", expiresAt: 0, runs: 0, lastStatus: null },
    ];
    const { f, calls } = mock((u, i) => (i?.method === "POST" ? json({ schedule: sched[0] }) : i?.method === "DELETE" ? json({ ok: true }) : json({ schedules: sched })));
    const store = createChatGoalStore(f);
    store.reset("s1");
    const { n, log } = notes();
    await runGoalSlash("loop", "5m check", "s1", store, n);
    expect(calls[0]?.body).toEqual({ kind: "loop", spec: "5m", prompt: "check" });
    await runGoalSlash("loop", "stop", "s1", store, n);
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((d) => d.url.split("/").pop())).toEqual(["a"]);
    expect(log).toContain("ok:Loop stopped");
  });
  test("/schedule rm and bad usage", async () => {
    const { f, calls } = mock((_u, i) => (i?.method === "DELETE" ? json({ ok: true }) : json({ schedules: [] })));
    const store = createChatGoalStore(f);
    store.reset("s1");
    const { n, log } = notes();
    await runGoalSlash("schedule", "rm xyz", "s1", store, n);
    expect(calls[0]).toMatchObject({ method: "DELETE" });
    await runGoalSlash("schedule", "nonsense", "s1", store, n);
    expect(log.at(-1)).toBe("info:Usage");
  });
});
