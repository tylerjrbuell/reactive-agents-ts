// Run: bun run repo test apps/cortex/server/tests/chat-plan.test.ts
//
// A chat session's plan: GET/PUT /api/chat/sessions/:id/plan over the framework session
// (`session.plan` / `session.setPlan`), persisted with the session (to-do list + plan meta).
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { chatPlanRoute } from "../api/chat-plan-route.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { cleanPlanSteps, planOfStored } from "../services/chat-session-plan.js";
import { chatMetaTools, planModeAddsTodo } from "../services/chat-meta-tools.js";
import { modeSwitchNeedsRebuild } from "../services/chat-session-mode.js";

function setup() {
  const path = tmpDbPath("chat-plan");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  const app = new Elysia().use(chatPlanRoute(svc));
  const call = (method: string, id: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost/api/chat/sessions/${id}/plan`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  return { db, svc, call, cleanup: async () => { await svc.disposeAll(); db.close(); rmDbFiles(path); } };
}
const CFG = { provider: "test", model: "m", enableTools: true };
type PlanBody = { plan: { id: string; source: string; steps: Array<{ id: string; title: string; tool?: string; status: string }> } | null };

describe("session plan route", () => {
  it("GET is null while no plan exists; 404 for an unknown session", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      expect(((await (await call("GET", id)).json()) as PlanBody).plan).toBeNull();
      expect((await call("GET", "nope")).status).toBe(404);
      expect((await call("PUT", "nope", { steps: [{ title: "a" }] })).status).toBe(404);
    } finally { await cleanup(); }
  });

  it("PUT records a user-edited plan through session.setPlan and seeds the to-do list", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const put = await call("PUT", id, { steps: [{ title: "Read config" }, { title: "Write the fix", tool: "file-write" }] });
      expect(put.status).toBe(200);
      const body = (await put.json()) as PlanBody;
      expect(body.plan?.source).toBe("user-edited");
      expect(body.plan?.steps.map((s) => [s.title, s.tool])).toEqual([["Read config", undefined], ["Write the fix", "file-write"]]);
      // The list the next turn seeds from is exactly the edited plan.
      expect(svc.getSession(id)!.todo.map((t) => t.title)).toEqual(["Read config", "Write the fix"]);
    } finally { await cleanup(); }
  });

  it("the plan persists per session: a new service over the same DB reads it back with tool hints", async () => {
    const { db, svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, { steps: [{ title: "One" }, { title: "Two", tool: "web-search", status: "done" }] });
      const reloaded = new ChatSessionService(db);
      const plan = reloaded.plans.read(id);
      expect(plan?.steps.map((s) => [s.title, s.status, s.tool])).toEqual([["One", "pending", undefined], ["Two", "done", "web-search"]]);
      expect(plan?.source).toBe("user-edited");
      await reloaded.disposeAll();
    } finally { await cleanup(); }
  });

  it("an empty edit clears the plan", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, { steps: [{ title: "One" }] });
      await call("PUT", id, { steps: [] });
      expect(((await (await call("GET", id)).json()) as PlanBody).plan).toBeNull();
    } finally { await cleanup(); }
  });

  it("refuses a bad edit with 400 and leaves the plan alone", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, { steps: [{ title: "Keep" }] });
      expect((await call("PUT", id, { steps: [{ title: "   " }] })).status).toBe(400);
      expect((await call("PUT", id, { steps: [{ title: "a", id: "x" }, { title: "b", id: "x" }] })).status).toBe(400);
      expect((await call("PUT", id, { steps: [{ title: "a", status: "bogus" }] })).status).toBe(422);
      expect(svc.plans.read(id)?.steps.map((s) => s.title)).toEqual(["Keep"]);
    } finally { await cleanup(); }
  });

  it("answers 409 while a turn is running", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const release = (svc as unknown as { acquireTurn: (id: string) => () => void }).acquireTurn(id);
      expect((await call("PUT", id, { steps: [{ title: "a" }] })).status).toBe(409);
      release();
    } finally { await cleanup(); }
  });
});

describe("plan pure rules", () => {
  it("cleanPlanSteps trims, bounds and rejects duplicates", () => {
    const ok = cleanPlanSteps([{ title: "  a  ", tool: " file-read " }]);
    expect(ok.ok && ok.steps).toEqual([{ title: "a", tool: "file-read" }]);
    expect(cleanPlanSteps([{ title: "" }]).ok).toBe(false);
    expect(cleanPlanSteps(Array.from({ length: 51 }, (_, i) => ({ title: `s${i}` }))).ok).toBe(false);
  });

  it("planOfStored maps the list and overlays the stored meta; empty list is no plan", () => {
    expect(planOfStored("s", [], null)).toBeNull();
    const plan = planOfStored("s", [{ id: "1", title: "a", status: "in_progress" }, { id: "2", title: "b", status: "completed" }], {
      id: "p", goal: "g", source: "harness-derived", createdAt: 5, tools: { "2": "file-write" },
    });
    expect(plan).toEqual({
      id: "p", goal: "g", source: "harness-derived", createdAt: 5,
      steps: [{ id: "1", title: "a", status: "in-progress" }, { id: "2", title: "b", status: "done", tool: "file-write" }],
    });
  });
});

describe("Plan mode opts the todo meta-tool in", () => {
  it("adds todo in plan mode, keeps an explicit choice, leaves execute and tools-off alone", () => {
    expect(chatMetaTools(undefined, "plan", true)).toEqual({ todo: true });
    expect(chatMetaTools({ enabled: true, brief: true }, "plan", true)).toEqual({ enabled: true, brief: true, todo: true });
    expect(chatMetaTools({ enabled: false }, "plan", true)).toEqual({ enabled: false });
    expect(chatMetaTools({ todo: true }, "plan", true)).toEqual({ todo: true });
    expect(chatMetaTools(undefined, "execute", true)).toBeUndefined();
    expect(chatMetaTools(undefined, "plan", false)).toBeUndefined();
  });

  it("planModeAddsTodo / modeSwitchNeedsRebuild: only Execute -> Plan on a cached agent without todo", () => {
    expect(planModeAddsTodo(undefined, true)).toBe(true);
    expect(planModeAddsTodo({ todo: true }, true)).toBe(false);
    const before = { mode: "execute" as const, agentConfig: CFG };
    expect(modeSwitchNeedsRebuild(before, "plan", true)).toBe(true);
    expect(modeSwitchNeedsRebuild(before, "plan", false)).toBe(false);
    expect(modeSwitchNeedsRebuild(before, "execute", true)).toBe(false);
    expect(modeSwitchNeedsRebuild({ ...before, mode: "plan" }, "plan", true)).toBe(false);
    expect(modeSwitchNeedsRebuild({ mode: "execute", agentConfig: { ...CFG, enableTools: false } }, "plan", true)).toBe(false);
  });

  it("setMode(plan) evicts a cached execute-built agent so the rebuilt one carries todo", async () => {
    const { svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await svc.chat(id, "hello");
      expect(svc.hasCachedAgent(id)).toBe(true);
      await svc.setMode(id, "plan");
      expect(svc.hasCachedAgent(id)).toBe(false);
    } finally { await cleanup(); }
  });
});
