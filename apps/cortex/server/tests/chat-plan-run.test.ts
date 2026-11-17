// Run: bun run repo test apps/cortex/server/tests/chat-plan-run.test.ts
//
// Run a chat plan in a strategy (services/chat-plan-run.ts): agent.execute(plan, { strategy }),
// the framework's PlanInvalidError surfaced with its reason, statuses from result.plan written
// back to the to-do rows, and POST /api/chat/sessions/:id/plan/execute.
import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { PlanInvalidError, type AgentResult } from "@reactive-agents/runtime";
import type { Plan } from "@reactive-agents/core";
import { chatPlanRoute } from "../api/chat-plan-route.js";
import { ChatPlanRun, planRunMessage, todoWithStatuses, type ChatPlanRunHost, type PlanRunnableAgent } from "../services/chat-plan-run.js";

const PLAN: Plan = {
  id: "p1",
  goal: "Write the report",
  createdAt: 0,
  source: "user-edited",
  steps: [
    { id: "a", title: "Search", status: "pending", args: { query: "x" } },
    { id: "b", title: "Write", status: "pending", dependsOn: ["a"] },
  ],
};
const DONE: Plan = { ...PLAN, steps: PLAN.steps.map((s) => ({ ...s, status: "done" as const })) };

const result = (over: Partial<AgentResult> = {}): AgentResult & { plan: Plan } =>
  ({ output: "report written", success: true, taskId: "t1", agentId: "chat-1", metadata: { duration: 1, cost: 0, tokensUsed: 10, stepsCount: 2 }, plan: DONE, ...over }) as AgentResult & { plan: Plan };

function harness(opts: { plan?: Plan | null; busy?: boolean; execute?: PlanRunnableAgent["execute"] } = {}) {
  const calls: { plan: Plan; options: unknown }[] = [];
  const persisted: { userMessage: string; reply: string }[] = [];
  const recorded: Plan[] = [];
  const evicted: string[] = [];
  const host: ChatPlanRunHost = {
    acquireTurn: () => {
      if (opts.busy) throw new Error("A turn is already running");
      return () => {};
    },
    agentFor: async () => ({
      execute:
        opts.execute ??
        (async (plan, options) => {
          calls.push({ plan, options });
          return result();
        }),
    }),
    planOf: () => (opts.plan === undefined ? PLAN : opts.plan),
    historyOf: () => [{ role: "user", content: "plan it", timestamp: 1 }],
    persistExchange: (_id, userMessage, reply) => void persisted.push({ userMessage, reply }),
    recordStatuses: (_id, plan) => void recorded.push(plan),
    evict: async (id) => void evicted.push(id),
  };
  return { run: new ChatPlanRun(host), calls, persisted, recorded, evicted };
}

describe("ChatPlanRun", () => {
  it("passes the saved plan, the chosen strategy and the history to agent.execute, then lands the exchange", async () => {
    const h = harness();
    const out = await h.run.run("s1", "blueprint");
    expect(out).toMatchObject({ ok: true, success: true, reply: "report written" });
    expect(h.calls[0]?.plan).toBe(PLAN);
    expect(h.calls[0]?.options).toMatchObject({ strategy: "blueprint", history: [{ role: "user" }] });
    expect(h.persisted).toEqual([{ userMessage: "Execute the plan with blueprint.", reply: "report written" }]);
    expect(h.recorded).toEqual([DONE]);
    expect(h.evicted).toEqual(["s1"]);
  });

  it("omits strategy when none is named, so the framework chooses by the plan", async () => {
    const h = harness();
    await h.run.run("s1", undefined);
    expect(h.calls[0]?.options).not.toHaveProperty("strategy");
    expect(planRunMessage(undefined)).toBe("Execute the plan.");
  });

  it("maps the framework's PlanInvalidError to invalid-plan with its reason and stores nothing", async () => {
    const h = harness({ execute: async () => { throw new PlanInvalidError({ reason: 'Step "b" depends on unknown step "q".' }); } });
    const out = await h.run.run("s1", undefined);
    expect(out).toMatchObject({ ok: false, code: "invalid-plan", reason: 'Step "b" depends on unknown step "q".' });
    expect(h.persisted).toEqual([]);
    expect(h.recorded).toEqual([]);
  });

  it("refuses with no-plan, busy and failed", async () => {
    expect(await harness({ plan: null }).run.run("s1", undefined)).toMatchObject({ ok: false, code: "no-plan" });
    expect(await harness({ busy: true }).run.run("s1", undefined)).toMatchObject({ ok: false, code: "busy" });
    expect(await harness({ execute: async () => { throw new Error("boom"); } }).run.run("s1", undefined)).toMatchObject({ ok: false, code: "failed", message: "boom" });
  });
});

describe("todoWithStatuses", () => {
  it("writes result statuses onto rows by id; skipped closes a row; unknown rows stay", () => {
    const todo = [
      { id: "a", title: "A", status: "pending" as const },
      { id: "b", title: "B", status: "pending" as const },
      { id: "z", title: "Z", status: "in_progress" as const },
    ];
    const plan: Plan = { ...PLAN, steps: [{ id: "a", title: "A", status: "done" }, { id: "b", title: "B", status: "skipped" }] };
    expect(todoWithStatuses(todo, plan).map((r) => r.status)).toEqual(["completed", "completed", "in_progress"]);
  });
});

describe("POST /api/chat/sessions/:id/plan/execute", () => {
  const app = (run: ChatPlanRun, known = true) =>
    new Elysia().use(
      chatPlanRoute({
        plans: { read: () => PLAN, write: async () => PLAN },
        planRun: run,
        getSession: () => (known ? {} : undefined),
      }),
    );
  const post = (a: ReturnType<typeof app>, body: unknown) =>
    a.handle(new Request("http://localhost/api/chat/sessions/s1/plan/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("returns the reply and the plan with result statuses", async () => {
    const res = await post(app(harness().run), { strategy: "plan-execute-reflect" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; plan: Plan };
    expect(body.reply).toBe("report written");
    expect(body.plan.steps.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("422 with the framework reason for an invalid plan; 409 busy; 404 unknown session; 422 for an unknown strategy", async () => {
    const invalid = harness({ execute: async () => { throw new PlanInvalidError({ reason: "Dependency cycle through step \"a\"." }); } });
    const res = await post(app(invalid.run), {});
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'The plan cannot run: Dependency cycle through step "a".', reason: 'Dependency cycle through step "a".' });
    expect((await post(app(harness({ busy: true }).run), {})).status).toBe(409);
    expect((await post(app(harness().run, false), {})).status).toBe(404);
    expect((await post(app(harness().run), { strategy: "react" })).status).toBe(422);
  });
});
