// Run: bun run repo test apps/cortex/server/tests/chat-plan-portable.test.ts
//
// A chat session's plan as a portable document: export (Markdown / HTML / JSON) and parse
// (Markdown or a JSON envelope) over the framework's own format functions, the goal that rides a
// PUT, and the move of tool hints from the plan meta onto the to-do rows (older rows keep working).
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { planFromMarkdown, planToJSON, planToMarkdown, type Plan } from "@reactive-agents/core";
import { Either } from "effect";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { chatPlanRoute } from "../api/chat-plan-route.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { getChatPlanMeta, getChatTodoWithHints } from "../db/chat-plan-queries.js";
import { getChatTodo, setChatTodo } from "../db/chat-queries.js";
import { planOfStored, seedTodoOf } from "../services/chat-session-plan.js";
import { exportPlan, importPlan } from "../services/chat-plan-portable.js";

function setup() {
  const path = tmpDbPath("chat-plan-portable");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  const app = new Elysia().use(chatPlanRoute(svc));
  const call = (method: string, id: string, suffix = "", body?: unknown) =>
    app.handle(
      new Request(`http://localhost/api/chat/sessions/${id}/plan${suffix}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  return { db, svc, call, cleanup: async () => { await svc.disposeAll(); db.close(); rmDbFiles(path); } };
}
const CFG = { provider: "test", model: "m", enableTools: true };
type PlanBody = { plan: Plan | null };
type ParseBody = { plan?: Plan; error?: string; reason?: string };

describe("plan export", () => {
  it("writes the saved plan in the framework's formats, with a download name", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, "", { steps: [{ title: "Read config" }, { title: "Write the fix", tool: "file-write", status: "done" }] });
      const saved = ((await (await call("GET", id)).json()) as PlanBody).plan as Plan;

      const md = await call("GET", id, "/export?format=markdown");
      expect(md.status).toBe(200);
      expect(md.headers.get("content-type")).toContain("text/markdown");
      expect(md.headers.get("content-disposition")).toBe(`attachment; filename="plan-${id}.md"`);
      expect(await md.text()).toBe(planToMarkdown(saved));

      const json = await call("GET", id, "/export?format=json");
      expect(await json.text()).toBe(planToJSON(saved));

      const html = await call("GET", id, "/export?format=html");
      expect(html.headers.get("content-type")).toContain("text/html");
      expect(await html.text()).toContain("<code>file-write</code>");

      // No format named = Markdown.
      expect(await (await call("GET", id, "/export")).text()).toBe(planToMarkdown(saved));
    } finally { await cleanup(); }
  });

  it("400 for an unknown format, 404 for an unknown session or a session with no plan", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      expect((await call("GET", id, "/export?format=markdown")).status).toBe(404);
      await call("PUT", id, "", { steps: [{ title: "a" }] });
      expect((await call("GET", id, "/export?format=pdf")).status).toBe(400);
      expect((await call("GET", "nope", "/export?format=json")).status).toBe(404);
    } finally { await cleanup(); }
  });

  it("a file name from an odd session id stays header-safe", () => {
    const plan: Plan = { id: "p", goal: "g", steps: [{ id: "1", title: "a", status: "pending" }], createdAt: 1, source: "model" };
    expect(exportPlan(plan, "json", 'a"b\r\nc/d').filename).toBe("plan-a-b--c-d.json");
  });
});

describe("plan import (parse, then apply through PUT)", () => {
  it("round trips an exported plan through the real framework functions and marks it user-edited", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, "", { goal: "Ship it", steps: [{ title: "One" }, { title: "Two (tool: x)", tool: "web-search", status: "in-progress" }] });
      const original = ((await (await call("GET", id)).json()) as PlanBody).plan as Plan;
      for (const format of ["markdown", "json"] as const) {
        const text = await (await call("GET", id, `/export?format=${format}`)).text();
        const res = (await (await call("POST", id, "/parse", { text })).json()) as ParseBody;
        expect(res.plan?.steps).toEqual(original.steps);
        expect(res.plan?.goal).toBe("Ship it");
        expect(res.plan?.source).toBe("user-edited");
      }
    } finally { await cleanup(); }
  });

  it("reads hand-written Markdown (plain list lines) as pending steps", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const res = (await (await call("POST", id, "/parse", { text: "# Trip\n1. Book flights\n2. Pack" })).json()) as ParseBody;
      expect(res.plan?.goal).toBe("Trip");
      expect(res.plan?.steps.map((s) => [s.title, s.status])).toEqual([["Book flights", "pending"], ["Pack", "pending"]]);
    } finally { await cleanup(); }
  });

  it("surfaces the framework's parse reason with 422", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const reasonOf = async (text: string) => {
        const r = await call("POST", id, "/parse", { text });
        const body = (await r.json()) as ParseBody;
        return [r.status, body.reason, typeof body.error === "string" && body.error.length > 0] as const;
      };
      expect(await reasonOf("just some prose, no list")).toEqual([422, "no-steps", true]);
      expect(await reasonOf("{ not json")).toEqual([422, "invalid-json", true]);
      expect(await reasonOf(JSON.stringify({ kind: "reactive-agents.plan", version: 9, plan: {} }))).toEqual([422, "unsupported-version", true]);
      expect(await reasonOf(JSON.stringify({ kind: "reactive-agents.plan", version: 1, plan: { id: 1 } }))).toEqual([422, "invalid-shape", true]);
      expect((await call("POST", "nope", "/parse", { text: "- a" })).status).toBe(404);
    } finally { await cleanup(); }
  });

  it("parsing changes nothing; applying the result through PUT keeps the session's plan id and takes the goal", async () => {
    const { db, svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, "", { steps: [{ title: "Old" }] });
      const before = svc.plans.read(id);
      const parsed = (await (await call("POST", id, "/parse", { text: planToMarkdown({ id: "foreign", goal: "New goal", steps: [{ id: "a", title: "Fresh", status: "pending", tool: "file-read" }], createdAt: 5, source: "model" }) })).json()) as ParseBody;
      expect(svc.plans.read(id)).toEqual(before);

      const put = (await (await call("PUT", id, "", { goal: parsed.plan?.goal, steps: parsed.plan?.steps })).json()) as PlanBody;
      expect(put.plan?.id).toBe(before?.id as string);
      expect(put.plan?.goal).toBe("New goal");
      expect(put.plan?.source).toBe("user-edited");
      expect(put.plan?.steps.map((s) => [s.title, s.tool])).toEqual([["Fresh", "file-read"]]);
      // And it survives a reload.
      const reloaded = new ChatSessionService(db);
      expect(reloaded.plans.read(id)?.goal).toBe("New goal");
      await reloaded.disposeAll();
    } finally { await cleanup(); }
  });

  it("importPlan is the framework parser plus user-edited authorship", () => {
    const md = "- [x] a\n- [ ] b";
    const direct = planFromMarkdown(md);
    const via = importPlan(md);
    expect(via.ok && via.plan.steps).toEqual(Either.isRight(direct) ? direct.right.steps : false);
    expect(via.ok && via.plan.source).toBe("user-edited");
  });
});

describe("tool hints ride the to-do rows (older plan_meta rows still read)", () => {
  const legacyMeta = { id: "plan-legacy", goal: "G", source: "user-edited", createdAt: 7, tools: { "2": "file-write" } };

  it("a row from before lists carried hints gets its hint from the meta, on read and when a session is rebuilt", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      setChatTodo(db, id, [{ id: "1", title: "a", status: "pending" }, { id: "2", title: "b", status: "completed" }]);
      db.prepare(`UPDATE cortex_chat_sessions SET plan_meta_json = ? WHERE session_id = ?`).run(JSON.stringify(legacyMeta), id);
      expect(svc.plans.read(id)?.steps.map((s) => [s.id, s.tool])).toEqual([["1", undefined], ["2", "file-write"]]);
      expect(seedTodoOf(db, id).map((t) => t.tool)).toEqual([undefined, "file-write"]);
      expect(getChatTodoWithHints(db, id)[1]?.tool).toBe("file-write");
    } finally { await cleanup(); }
  });

  it("a row's own hint beats the legacy one, and origin marks a harness-derived plan", () => {
    const plan = planOfStored(
      "s",
      [{ id: "2", title: "b", status: "pending", tool: "web-search", origin: "harness-derived" }],
      { id: "p", goal: "", source: "model", createdAt: 1, tools: { "2": "file-write" } },
    );
    expect(plan?.steps[0]?.tool).toBe("web-search");
    expect(plan?.source).toBe("harness-derived");
  });

  it("an edit stores the hint on the row and no longer writes tools into the plan meta", async () => {
    const { db, svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, "", { steps: [{ title: "a", tool: "file-read" }] });
      expect(getChatTodo(db, id)[0]?.tool).toBe("file-read");
      const meta = getChatPlanMeta(db, id);
      expect(meta?.tools).toEqual({});
      const raw = db.prepare(`SELECT plan_meta_json FROM cortex_chat_sessions WHERE session_id = ?`).get(id) as { plan_meta_json: string };
      expect(Object.keys(JSON.parse(raw.plan_meta_json))).not.toContain("tools");
    } finally { await cleanup(); }
  });
});
