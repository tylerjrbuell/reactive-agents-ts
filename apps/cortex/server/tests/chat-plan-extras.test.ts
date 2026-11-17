// Run: bun run repo test apps/cortex/server/tests/chat-plan-extras.test.ts
//
// A chat plan's step `dependsOn` / `args`: validated with core's dependency rules, carried by the
// plan routes, persisted beside the to-do rows (plan meta) and merged back onto the plan.
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { getChatPlanMeta } from "../db/chat-plan-queries.js";
import { chatPlanRoute } from "../api/chat-plan-route.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { cleanPlanSteps, persistSessionPlan } from "../services/chat-session-plan.js";
import { cleanStepExtras, extrasOfSteps, pruneExtras, withExtras } from "../services/chat-plan-extras.js";
import { exportPlan, importPlan } from "../services/chat-plan-portable.js";

function setup() {
  const path = tmpDbPath("chat-plan-extras");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  const app = new Elysia().use(chatPlanRoute(svc));
  const call = (method: string, suffix: string, id: string, body?: unknown) =>
    app.handle(new Request(`http://localhost/api/chat/sessions/${id}/plan${suffix}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }));
  return { db, svc, call, cleanup: async () => { await svc.disposeAll(); db.close(); rmDbFiles(path); } };
}
const CFG = { provider: "test", model: "m", enableTools: true };
type Step = { id: string; title: string; dependsOn?: string[]; args?: Record<string, unknown> };
type PlanBody = { plan: { steps: Step[] } | null; error?: string };

describe("cleanPlanSteps with dependsOn and args", () => {
  it("keeps trimmed, de-duplicated prerequisites and a JSON object of args", () => {
    const r = cleanPlanSteps([
      { id: "a", title: "Search" },
      { id: "b", title: "Write", dependsOn: [" a ", "a", ""], args: { path: "out.md" } },
    ]);
    expect(r).toEqual({ ok: true, steps: [{ id: "a", title: "Search" }, { id: "b", title: "Write", dependsOn: ["a"], args: { path: "out.md" } }] });
  });

  it("refuses an unknown prerequisite, a self reference and a cycle with the framework's wording", () => {
    const unknown = cleanPlanSteps([{ id: "a", title: "A", dependsOn: ["zzz"] }]);
    expect(unknown).toMatchObject({ ok: false });
    expect(!unknown.ok && unknown.error).toContain('unknown step "zzz"');
    const self = cleanPlanSteps([{ id: "a", title: "A", dependsOn: ["a"] }]);
    expect(!self.ok && self.error).toContain("depends on itself");
    const cycle = cleanPlanSteps([{ id: "a", title: "A", dependsOn: ["b"] }, { id: "b", title: "B", dependsOn: ["a"] }]);
    expect(!cycle.ok && cycle.error).toContain("cycle");
  });

  it("refuses extras on a step with no id, and oversized args", () => {
    expect(cleanPlanSteps([{ title: "A", args: { x: 1 } }])).toMatchObject({ ok: false });
    expect(cleanStepExtras({ args: { big: "x".repeat(9000) } })).toMatchObject({ ok: false });
  });
});

describe("plan extras", () => {
  it("prune drops gone steps and prerequisites that name them", () => {
    const extras = extrasOfSteps([{ id: "a", title: "A" }, { id: "b", title: "B", dependsOn: ["a", "c"], args: { k: 1 } }, { id: "c", title: "C", args: { z: 2 } }]);
    expect(pruneExtras(extras, ["a", "b"])).toEqual({ dependsOn: { b: ["a"] }, args: { b: { k: 1 } } });
  });

  it("withExtras puts them back on the steps by id", () => {
    const plan = { id: "p", goal: "g", createdAt: 0, source: "user-edited" as const, steps: [{ id: "a", title: "A", status: "pending" as const }, { id: "b", title: "B", status: "pending" as const }] };
    const out = withExtras(plan, { dependsOn: { b: ["a"] }, args: { a: { q: "x" } } });
    expect(out.steps.map((s) => [s.dependsOn, s.args])).toEqual([[undefined, { q: "x" }], [["a"], undefined]]);
  });
});

describe("plan routes carry dependsOn and args", () => {
  const STEPS = [{ id: "s1", title: "Search the web", tool: "web-search", args: { query: "bun" } }, { id: "s2", title: "Write it up", dependsOn: ["s1"] }];

  it("PUT returns them, GET and a restarted service read them back, and the to-do rows stay the store of steps", async () => {
    const { db, svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const put = (await (await call("PUT", "", id, { steps: STEPS })).json()) as PlanBody;
      expect(put.plan?.steps.map((s) => [s.dependsOn, s.args])).toEqual([[undefined, { query: "bun" }], [["s1"], undefined]]);
      const got = (await (await call("GET", "", id)).json()) as PlanBody;
      expect(got.plan?.steps.map((s) => [s.dependsOn, s.args])).toEqual([[undefined, { query: "bun" }], [["s1"], undefined]]);
      // Rows hold no extras.
      expect(JSON.stringify(svc.getSession(id)!.todo)).not.toContain("dependsOn");
      const reloaded = new ChatSessionService(db);
      expect(reloaded.plans.read(id)?.steps[1]?.dependsOn).toEqual(["s1"]);
      await reloaded.disposeAll();
    } finally { await cleanup(); }
  });

  it("PUT refuses a bad graph with 400 and the framework reason; the saved plan is untouched", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", "", id, { steps: STEPS });
      const bad = await call("PUT", "", id, { steps: [{ id: "a", title: "A", dependsOn: ["b"] }, { id: "b", title: "B", dependsOn: ["a"] }] });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as PlanBody).error).toContain("cycle");
      expect(((await (await call("GET", "", id)).json()) as PlanBody).plan?.steps.map((s) => s.id)).toEqual(["s1", "s2"]);
    } finally { await cleanup(); }
  });

  it("a later turn that keeps persisting the plan keeps extras only for steps that remain", async () => {
    const { db, svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", "", id, { steps: STEPS });
      const full = svc.plans.read(id)!;
      // A turn that left only s2: s1's args go, and s2's prerequisite on s1 goes with it.
      persistSessionPlan(db, id, { plan: { ...full, steps: full.steps.filter((s) => s.id === "s2") }, todo: () => svc.getSession(id)!.todo.filter((t) => t.id === "s2") });
      const meta = getChatPlanMeta(db, id);
      expect(meta?.dependsOn).toBeUndefined();
      expect(meta?.args).toBeUndefined();
      // The same turn with both steps kept leaves the extras as they were.
      await call("PUT", "", id, { steps: STEPS });
      persistSessionPlan(db, id, { plan: svc.plans.read(id)!, todo: () => svc.getSession(id)!.todo });
      expect(getChatPlanMeta(db, id)?.dependsOn).toEqual({ s2: ["s1"] });
    } finally { await cleanup(); }
  });

  it("export carries them and an import reads them back (core's formats)", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", "", id, { steps: STEPS });
      const plan = svc.plans.read(id)!;
      for (const format of ["markdown", "json"] as const) {
        const imported = importPlan(exportPlan(plan, format, id).body);
        expect(imported.ok).toBe(true);
        if (imported.ok) expect(imported.plan.steps.map((s) => [s.dependsOn, s.args])).toEqual([[undefined, { query: "bun" }], [["s1"], undefined]]);
      }
    } finally { await cleanup(); }
  });
});
