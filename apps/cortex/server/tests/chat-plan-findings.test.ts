// Run: bun run repo test apps/cortex/server/tests/chat-plan-findings.test.ts
//
// A plan's recon findings (`Plan.findings`): validated at the edge, persisted beside the plan meta,
// read back with the plan, kept through a step-only edit, cleared by an empty list, and exported by
// the framework's own formats.
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { planToMarkdown, type Plan, type PlanFinding } from "@reactive-agents/core";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { chatPlanRoute } from "../api/chat-plan-route.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { getChatPlanMeta, setChatPlanMeta } from "../db/chat-plan-queries.js";
import { cleanPlanFindings, findingsOfStored, PLAN_MAX_FINDINGS } from "../services/chat-plan-findings.js";
import { planOfStored, planSeedOf } from "../services/chat-session-plan.js";

const F1: PlanFinding = { id: "f1", tool: "umami/get-websites", summary: "site id is abc-123" };
const F2: PlanFinding = { id: "f2", tool: "web-search", summary: "docs live at example.com", at: 5 };

describe("cleanPlanFindings", () => {
  it("trims and keeps valid findings", () => {
    const res = cleanPlanFindings([{ id: " f1 ", tool: " web-search ", summary: "  hi  " }]);
    expect(res).toEqual({ ok: true, findings: [{ id: "f1", tool: "web-search", summary: "hi" }] });
  });
  it("rejects blanks, duplicates and too many", () => {
    expect(cleanPlanFindings([{ id: "a", tool: "t", summary: " " }]).ok).toBe(false);
    expect(cleanPlanFindings([{ id: "a", tool: "", summary: "s" }]).ok).toBe(false);
    expect(cleanPlanFindings([F1, F1]).ok).toBe(false);
    expect(cleanPlanFindings(Array.from({ length: PLAN_MAX_FINDINGS + 1 }, (_, i) => ({ id: `f${i}`, tool: "t", summary: "s" }))).ok).toBe(false);
  });
  it("findingsOfStored drops malformed entries", () => {
    expect(findingsOfStored([F1, { id: 1 }, null, "x", F2])).toEqual([F1, F2]);
    expect(findingsOfStored("nope")).toEqual([]);
  });
});

function setup() {
  const path = tmpDbPath("chat-plan-findings");
  const db = openDatabase(path);
  const svc = new ChatSessionService(db);
  const app = new Elysia().use(chatPlanRoute(svc));
  const call = (method: string, id: string, suffix = "", body?: unknown) =>
    app.handle(new Request(`http://localhost/api/chat/sessions/${id}/plan${suffix}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }));
  return { db, svc, call, cleanup: async () => { await svc.disposeAll(); db.close(); rmDbFiles(path); } };
}
const CFG = { provider: "test", model: "m", enableTools: true };
type PlanBody = { plan: Plan | null; error?: string };

describe("plan findings over the plan route", () => {
  it("a PUT with findings stores them; GET and export carry them", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const put = (await (await call("PUT", id, "", { steps: [{ title: "Query stats" }], findings: [F1, F2] })).json()) as PlanBody;
      expect(put.plan?.findings?.map((f) => f.id)).toEqual(["f1", "f2"]);
      const got = ((await (await call("GET", id)).json()) as PlanBody).plan as Plan;
      expect(got.findings?.map((f) => f.summary)).toEqual([F1.summary, F2.summary]);
      expect(await (await call("GET", id, "/export?format=markdown")).text()).toBe(planToMarkdown(got));
      expect(await (await call("GET", id, "/export?format=markdown")).text()).toContain("site id is abc-123");
    } finally { await cleanup(); }
  });

  it("a step-only edit keeps the findings; a removal drops one; an empty list clears them", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      await call("PUT", id, "", { steps: [{ title: "a" }], findings: [F1, F2] });
      const kept = (await (await call("PUT", id, "", { steps: [{ title: "a" }, { title: "b" }] })).json()) as PlanBody;
      expect(kept.plan?.findings?.length).toBe(2);
      const one = (await (await call("PUT", id, "", { steps: [{ title: "a" }], findings: [F2] })).json()) as PlanBody;
      expect(one.plan?.findings?.map((f) => f.id)).toEqual(["f2"]);
      const none = (await (await call("PUT", id, "", { steps: [{ title: "a" }], findings: [] })).json()) as PlanBody;
      expect(none.plan?.findings ?? []).toEqual([]);
    } finally { await cleanup(); }
  });

  it("400 for an invalid finding", async () => {
    const { svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      const res = await call("PUT", id, "", { steps: [{ title: "a" }], findings: [{ id: "x", tool: "t", summary: "" }] });
      expect(res.status).toBe(400);
    } finally { await cleanup(); }
  });
});

describe("a session rebuilt from storage", () => {
  it("is seeded with the stored findings: a step-only edit and a read keep them", async () => {
    const { db, svc, call, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      setChatPlanMeta(db, id, { id: "p", goal: "g", source: "model", createdAt: 1, findings: [F1, F2] });
      const edited = (await (await call("PUT", id, "", { steps: [{ title: "a" }] })).json()) as PlanBody;
      expect(edited.plan?.findings?.map((f) => f.id)).toEqual(["f1", "f2"]);
      const read = (await (await call("GET", id, "")).json()) as PlanBody;
      expect(read.plan?.findings?.map((f) => f.id)).toEqual(["f1", "f2"]);
    } finally { await cleanup(); }
  });
});

describe("planSeedOf", () => {
  it("seeds the stored to-do list and findings, each only when present", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      expect(planSeedOf(db, id)).toEqual({});
      setChatPlanMeta(db, id, { id: "p", goal: "g", source: "model", createdAt: 1, findings: [F1, F2] });
      expect(planSeedOf(db, id)).toEqual({ initialPlanFindings: [F1, F2] });
      setChatPlanMeta(db, id, { id: "p", goal: "g", source: "model", createdAt: 1 });
      expect(planSeedOf(db, id)).toEqual({});
    } finally { await cleanup(); }
  });
});

describe("plan findings in storage", () => {
  it("planOfStored carries the meta's findings", () => {
    const plan = planOfStored("s", [{ id: "1", title: "a", status: "pending" }], { id: "p", goal: "g", source: "model", createdAt: 1, tools: {}, findings: [F1] });
    expect(plan?.findings).toEqual([F1]);
    expect(planOfStored("s", [{ id: "1", title: "a", status: "pending" }], { id: "p", goal: "g", source: "model", createdAt: 1, tools: {} })?.findings).toBeUndefined();
  });

  it("a stored meta with findings reads back, and a corrupt finding is dropped", async () => {
    const { db, svc, cleanup } = setup();
    try {
      const id = await svc.createSession({ agentConfig: CFG });
      setChatPlanMeta(db, id, { id: "p", goal: "g", source: "model", createdAt: 1, findings: [F1] });
      expect(getChatPlanMeta(db, id)?.findings).toEqual([F1]);
    } finally { await cleanup(); }
  });
});
