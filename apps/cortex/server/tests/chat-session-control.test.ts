// Run: bun test apps/cortex/server/tests/chat-session-control.test.ts --timeout 15000
//
// Agent session control (plan 5, S1+S2): the `session-control` tool only PROPOSES; a human
// Apply is the sole path to a config / goal / schedule change.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { createChatSession, getChatSession, updateSessionAgentConfig } from "../db/chat-queries.js";
import { ChatScheduleService, MAX_SCHEDULES_PER_SESSION } from "../services/chat-schedule-service.js";
import { ChatGoalService } from "../services/chat-goal-service.js";
import { ChatProposalService, MAX_PENDING_PROPOSALS, type ProposalHost } from "../services/chat-proposal-service.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { SESSION_ACTIONS, healAction, type MutatingAction } from "../services/session-actions.js";
import { makeSessionControlTool } from "../services/session-control-tool.js";
import { chatRouter } from "../api/chat.js";
import { normalizeToolSchema } from "../../../../packages/llm-provider/src/schema-utils.js";

const MODELS: Record<string, readonly string[]> = { ollama: ["qwen3:14b", "qwen3:4b"], anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5"] };

describe("session control", () => {
  let db: Database;
  let sid: string;
  let sessions: { patches: Array<Record<string, unknown>>; busy: boolean; failPatch: boolean };
  let schedules: ChatScheduleService;
  let goals: ChatGoalService;
  let proposals: ChatProposalService;

  const config = () => getChatSession(db, sid)!.agentConfig;
  const snapshot = () =>
    JSON.stringify({
      config: config(),
      schedules: schedules.list(sid),
      goal: goals.get(sid),
    });

  const call = async (args: Record<string, unknown>): Promise<string> => {
    const tool = makeSessionControlTool(sid, proposals);
    return (await Effect.runPromise(tool.handler(args))) as string;
  };

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    sid = createChatSession(db, { agentConfig: { provider: "ollama", model: "qwen3:4b" } });
    sessions = { patches: [], busy: false, failPatch: false };
    schedules = new ChatScheduleService(db, async () => ({ reply: "ok", tokensUsed: 0, cost: 0 }));
    goals = new ChatGoalService(db, async () => ({ reply: "ok", tokensUsed: 0, cost: 0 }));
    const host: ProposalHost = {
      getConfig: (id) => getChatSession(db, id)?.agentConfig ?? null,
      patchConfig: async (id, patch) => {
        if (sessions.failPatch) throw new Error("boom");
        sessions.patches.push(patch);
        const cur = getChatSession(db, id)!.agentConfig;
        updateSessionAgentConfig(db, id, { ...cur, ...patch });
      },
      isBusy: () => sessions.busy,
      schedules,
      goals,
      providers: () => ["anthropic", "ollama", "test"],
      models: async (p) => MODELS[p] ?? [],
      skills: () => ({ names: ["pdf-tools", "research"], paths: [".agents/skills"] }),
    };
    proposals = new ChatProposalService(db, host);
  });
  afterEach(() => {
    schedules.dispose();
    goals.dispose();
    db.close();
  });

  const VALID: ReadonlyArray<readonly [MutatingAction, Record<string, unknown>]> = [
    ["set-model", { value: "qwen3:14b" }],
    ["set-provider", { value: "anthropic", model: "claude-haiku-4-5" }],
    ["set-thinking", { value: "off" }],
    ["pin-skill", { value: "research" }],
    ["add-doc", { value: "https://example.com/spec.md" }],
    ["start-goal", { objective: "ship the report", maxSegments: 3 }],
    ["set-loop", { interval: "1h", prompt: "check prices" }],
    ["set-schedule", { cron: "0 9 * * *", prompt: "morning brief" }],
  ];

  describe("proposing: every action valid", () => {
    for (const [action, args] of VALID) {
      it(`${action} creates a proposal`, async () => {
        const out = await call({ action, ...args });
        expect(out).toMatch(/^proposed: .+; awaiting user Apply$/);
        const [p] = proposals.list(sid);
        expect(p).toMatchObject({ action, status: "proposed" });
        expect(p?.summary.length).toBeGreaterThan(0);
      });
    }

    it("stop-loop and cancel-goal propose against live state", async () => {
      const s = schedules.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: "x" });
      if (!s.ok) throw new Error(s.message);
      goals.propose(sid, { objective: "g" });
      expect(await call({ action: "stop-loop", id: s.schedule.id.slice(0, 6) })).toMatch(/^proposed: stop loop/);
      expect(await call({ action: "cancel-goal" })).toMatch(/^proposed: cancel goal/);
      expect(proposals.list(sid).map((p) => p.action)).toEqual(["stop-loop", "cancel-goal"]);
      expect(proposals.list(sid)[0]?.args).toEqual({ id: s.schedule.id });
    });
  });

  describe("proposing: invalid input names valid options", () => {
    const INVALID: ReadonlyArray<readonly [string, Record<string, unknown>, RegExp]> = [
      ["unknown action", { action: "format-disk" }, /Valid actions: .*set-model/],
      ["set-model missing value", { action: "set-model" }, /needs value/],
      ["set-model unknown model", { action: "set-model", value: "gpt-9" }, /unknown model.*Valid: qwen3:14b, qwen3:4b/],
      ["set-provider unknown", { action: "set-provider", value: "skynet" }, /unknown provider.*Valid: anthropic, ollama, test/],
      ["set-provider model of another provider", { action: "set-provider", value: "anthropic", model: "qwen3:14b" }, /unknown model/],
      ["set-thinking bad value", { action: "set-thinking", value: "maybe" }, /on, off or auto/],
      ["pin-skill unknown", { action: "pin-skill", value: "nope" }, /unknown skill.*Valid: pdf-tools, research/],
      ["add-doc non-url", { action: "add-doc", value: "/etc/passwd" }, /http\(s\) URL/],
      ["start-goal no objective", { action: "start-goal" }, /needs objective/],
      ["start-goal widens budget", { action: "start-goal", objective: "x", maxCostUsd: 50 }, /capped at/],
      ["set-loop under a minute", { action: "set-loop", interval: "30s", prompt: "x" }, /invalid interval/],
      ["set-loop no prompt", { action: "set-loop", interval: "5m" }, /prompt is required/],
      ["set-loop over-long ttl", { action: "set-loop", interval: "5m", prompt: "x", ttlHours: 24 * 20 }, /capped at 168/],
      ["set-loop widens cost", { action: "set-loop", interval: "5m", prompt: "x", maxCostUsd: 9 }, /capped at 0.25/],
      ["set-schedule bad cron", { action: "set-schedule", cron: "nope", prompt: "x" }, /invalid cron/],
      ["stop-loop nothing active", { action: "stop-loop", id: "abc" }, /no active schedule/],
      ["cancel-goal no goal", { action: "cancel-goal" }, /no goal to cancel/],
    ];
    for (const [name, args, re] of INVALID) {
      it(name, async () => {
        const out = await call(args);
        expect(out.startsWith("error: ")).toBe(true);
        expect(out).toMatch(re);
        expect(proposals.list(sid)).toHaveLength(0);
      });
    }

    it("enforces the schedule cap from the schedule service", async () => {
      for (let i = 0; i < MAX_SCHEDULES_PER_SESSION; i++) {
        const r = schedules.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: `p${i}` });
        expect(r.ok).toBe(true);
      }
      expect(await call({ action: "set-loop", interval: "1h", prompt: "one too many" })).toMatch(/already has 3 active schedules/);
    });

    it("rejects a second goal while one is active", async () => {
      goals.propose(sid, { objective: "first" });
      const g = goals.accept(sid);
      expect(g.ok).toBe(true);
      expect(await call({ action: "start-goal", objective: "second" })).toMatch(/already has a active goal/);
      goals.cancel(sid);
    });
  });

  describe("healing", () => {
    it("heals action and argument aliases", async () => {
      expect(healAction("LOOP")).toEqual({ ok: true, action: "set-loop" });
      expect(healAction("switch-model")).toEqual({ ok: true, action: "set-model" });
      expect(await call({ action: "loop", every: "2h", task: "ping" })).toMatch(/^proposed: run every 2h/);
      expect(await call({ action: "model", name: "QWEN3:14B" })).toMatch(/^proposed: switch model to qwen3:14b/);
      expect(proposals.list(sid)[0]?.args).toEqual({ interval: "2h", prompt: "ping" });
    });

    it("coerces numeric strings", async () => {
      expect(await call({ action: "start-goal", objective: "x", maxSegments: "2", maxCostUsd: "0.5" })).toMatch(/^proposed: /);
      expect(proposals.list(sid)[0]?.args).toMatchObject({ maxSegments: 2, maxCostUsd: 0.5 });
    });
  });

  describe("injection guard (red-on-cut): the tool never mutates without Apply", () => {
    it("calling every action leaves config, schedules and goals untouched", async () => {
      const s = schedules.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: "keep" });
      if (!s.ok) throw new Error(s.message);
      goals.propose(sid, { objective: "existing" });
      const before = snapshot();
      for (const [action, args] of VALID) await call({ action, ...args });
      await call({ action: "stop-loop", id: s.schedule.id });
      await call({ action: "cancel-goal" });
      await call({ action: "status" });
      await call({ action: "list-schedules" });
      expect(snapshot()).toBe(before);
      expect(sessions.patches).toHaveLength(0);
      expect(proposals.list(sid).length).toBeGreaterThan(0);
    });

    it("apply is the only path to a change", async () => {
      await call({ action: "set-model", value: "qwen3:14b" });
      expect(config().model).toBe("qwen3:4b");
      const [p] = proposals.list(sid);
      const r = await proposals.apply(sid, p!.id);
      expect(r.ok).toBe(true);
      expect(config().model).toBe("qwen3:14b");
    });

    it("a flood of proposals is capped and identical ones are deduped", async () => {
      await call({ action: "set-thinking", value: "on" });
      await call({ action: "set-thinking", value: "on" });
      expect(proposals.list(sid)).toHaveLength(1);
      for (let i = 0; i < MAX_PENDING_PROPOSALS + 3; i++) await call({ action: "set-loop", interval: `${i + 1}h`, prompt: "x" });
      expect(proposals.list(sid)).toHaveLength(MAX_PENDING_PROPOSALS);
      expect(await call({ action: "set-model", value: "qwen3:14b" })).toMatch(/must Apply or Dismiss/);
    });
  });

  describe("apply", () => {
    it("is idempotent: a repeat is a conflict and never re-applies", async () => {
      await call({ action: "set-loop", interval: "1h", prompt: "tick" });
      const id = proposals.list(sid)[0]!.id;
      expect((await proposals.apply(sid, id)).ok).toBe(true);
      const again = await proposals.apply(sid, id);
      expect(again).toMatchObject({ ok: false, code: "conflict" });
      expect(schedules.list(sid)).toHaveLength(1);
      expect(proposals.list(sid)[0]?.status).toBe("applied");
    });

    it("concurrent applies apply exactly once", async () => {
      await call({ action: "set-loop", interval: "1h", prompt: "tick" });
      const id = proposals.list(sid)[0]!.id;
      const results = await Promise.all([proposals.apply(sid, id), proposals.apply(sid, id), proposals.apply(sid, id)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(schedules.list(sid)).toHaveLength(1);
    });

    it("applies each action through the existing services", async () => {
      for (const [action, args] of VALID) await call({ action, ...args });
      for (const p of proposals.list(sid)) {
        const r = await proposals.apply(sid, p.id);
        expect(r.ok).toBe(true);
      }
      const c = config();
      expect(c).toMatchObject({ provider: "anthropic", model: "claude-haiku-4-5", thinking: false });
      expect((c.skills as { activate: string[]; paths: string[] }).activate).toEqual(["research"]);
      expect((c.skills as { paths: string[] }).paths).toEqual([".agents/skills"]);
      expect(c.documents).toEqual([{ source: "https://example.com/spec.md" }]);
      expect(goals.get(sid)?.goal).toMatchObject({ objective: "ship the report", status: "proposed" });
      expect(goals.get(sid)?.goal.budget.maxSegments).toBe(3);
      expect(schedules.list(sid).map((s) => s.kind).sort()).toEqual(["cron", "loop"]);
    });

    it("stop-loop and cancel-goal apply", async () => {
      const s = schedules.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: "x" });
      if (!s.ok) throw new Error(s.message);
      goals.propose(sid, { objective: "g" });
      await call({ action: "stop-loop", id: s.schedule.id });
      await call({ action: "cancel-goal" });
      for (const p of proposals.list(sid)) expect((await proposals.apply(sid, p.id)).ok).toBe(true);
      expect(schedules.list(sid)).toHaveLength(0);
      expect(goals.get(sid)?.goal.status).toBe("cancelled");
    });

    it("failure keeps the proposal `proposed` with `error` set, and it can be retried", async () => {
      await call({ action: "set-model", value: "qwen3:14b" });
      const id = proposals.list(sid)[0]!.id;
      sessions.busy = true;
      const r = await proposals.apply(sid, id);
      expect(r).toMatchObject({ ok: false, code: "failed" });
      expect(proposals.list(sid)[0]).toMatchObject({ status: "proposed", error: expect.stringContaining("busy") });
      sessions.busy = false;
      expect((await proposals.apply(sid, id)).ok).toBe(true);
      expect(proposals.list(sid)[0]?.error).toBeUndefined();
    });

    it("a throwing effect is a failure, not a crash", async () => {
      await call({ action: "set-model", value: "qwen3:14b" });
      sessions.failPatch = true;
      const r = await proposals.apply(sid, proposals.list(sid)[0]!.id);
      expect(r).toMatchObject({ ok: false, code: "failed", message: "boom" });
    });

    it("re-validates at apply time (state changed since the proposal)", async () => {
      await call({ action: "set-loop", interval: "1h", prompt: "x" });
      for (let i = 0; i < MAX_SCHEDULES_PER_SESSION; i++) schedules.create({ sessionId: sid, kind: "loop", spec: "5m", prompt: `p${i}` });
      const r = await proposals.apply(sid, proposals.list(sid)[0]!.id);
      expect(r).toMatchObject({ ok: false, code: "failed" });
      expect(schedules.list(sid)).toHaveLength(MAX_SCHEDULES_PER_SESSION);
    });

    it("dismiss is final", async () => {
      await call({ action: "set-model", value: "qwen3:14b" });
      const id = proposals.list(sid)[0]!.id;
      expect((await proposals.dismiss(sid, id)).ok).toBe(true);
      expect(await proposals.apply(sid, id)).toMatchObject({ ok: false, code: "conflict" });
      expect(config().model).toBe("qwen3:4b");
    });
  });

  describe("read-only actions", () => {
    it("status is stable and compact", async () => {
      const expected = "provider=ollama | model=qwen3:4b | thinking=auto | goal=none | schedules=none | skills=none | docs=0";
      expect(await call({ action: "status" })).toBe(expected);
      expect(await call({ action: "status" })).toBe(expected);
      expect(proposals.list(sid)).toHaveLength(0);
    });

    it("status reflects applied changes; list-schedules lists live ones", async () => {
      await call({ action: "set-thinking", value: "on" });
      await proposals.apply(sid, proposals.list(sid)[0]!.id);
      const s = schedules.create({ sessionId: sid, kind: "loop", spec: "1h", prompt: "ping" });
      if (!s.ok) throw new Error(s.message);
      expect(await call({ action: "status" })).toContain("thinking=on");
      expect(await call({ action: "status" })).toContain(`${s.schedule.id.slice(0, 8)} every 1h "ping"`);
      expect(await call({ action: "list-schedules" })).toBe(`${s.schedule.id.slice(0, 8)} loop 1h: ping`.replace("loop", "every"));
    });
  });

  describe("tool schema", () => {
    const tool = makeSessionControlTool("s", proposals);
    const wire = {
      type: "object",
      properties: Object.fromEntries(
        tool.definition.parameters.map((p) => [
          p.name,
          { type: p.type ?? "string", description: p.description, ...(p.enum ? { enum: p.enum } : {}) },
        ]),
      ),
      required: tool.definition.parameters.filter((p) => p.required).map((p) => p.name),
    };

    it("passes normalizeToolSchema with zero repairs", () => {
      expect(normalizeToolSchema(wire).repairs).toEqual([]);
    });

    it("is flat, requires only action, and advertises the action enum", () => {
      const params = tool.definition.parameters;
      expect(params.filter((p) => p.required).map((p) => p.name)).toEqual(["action"]);
      expect(params.find((p) => p.name === "action")?.enum).toEqual([...SESSION_ACTIONS]);
      expect(params.every((p) => p.type === "string" || p.type === "number")).toBe(true);
      expect(tool.definition.name).toBe("session-control");
    });
  });

  describe("REST contract", () => {
    const app = () => new Elysia().use(chatRouter({} as ChatSessionService, schedules, goals, proposals));
    const req = (method: string, path: string) => app().handle(new Request(`http://localhost/api/chat/sessions/${sid}${path}`, { method }));

    it("lists, applies (409 on repeat), dismisses, 404s", async () => {
      await call({ action: "set-model", value: "qwen3:14b" });
      await call({ action: "set-thinking", value: "off" });
      const list = (await (await req("GET", "/proposals")).json()) as { proposals: Array<{ id: string; action: string; args: Record<string, unknown>; summary: string; status: string; createdAt: number }> };
      expect(list.proposals).toHaveLength(2);
      expect(Object.keys(list.proposals[0]!).sort()).toEqual(["action", "args", "createdAt", "id", "status", "summary"]);
      const [a, b] = list.proposals;
      const ok = await req("POST", `/proposals/${a!.id}/apply`);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { proposal: { status: string } }).proposal.status).toBe("applied");
      expect((await req("POST", `/proposals/${a!.id}/apply`)).status).toBe(409);
      expect((await req("POST", `/proposals/${a!.id}/dismiss`)).status).toBe(409);
      const d = await req("POST", `/proposals/${b!.id}/dismiss`);
      expect(d.status).toBe(200);
      expect(((await d.json()) as { proposal: { status: string } }).proposal.status).toBe("dismissed");
      expect((await req("POST", "/proposals/nope/apply")).status).toBe(404);
      expect((await req("POST", "/proposals/nope/dismiss")).status).toBe(404);
    });

    it("apply failure is 422 with the proposal still `proposed` and `error` set", async () => {
      await call({ action: "set-model", value: "qwen3:14b" });
      sessions.busy = true;
      const id = proposals.list(sid)[0]!.id;
      const res = await req("POST", `/proposals/${id}/apply`);
      expect(res.status).toBe(422);
      const body = (await res.json()) as { proposal: { status: string; error?: string } };
      expect(body.proposal.status).toBe("proposed");
      expect(body.proposal.error).toBeTruthy();
    });

    it("an unknown session has no proposals", async () => {
      const res = await app().handle(new Request("http://localhost/api/chat/sessions/ghost/proposals"));
      expect(await res.json()).toEqual({ proposals: [] });
    });
  });
});

describe("agentControl wiring (end to end, test provider)", () => {
  let db: Database;
  let svc: ChatSessionService;
  let schedules: ChatScheduleService;
  let goals: ChatGoalService;
  let proposals: ChatProposalService;

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ChatSessionService(db);
    schedules = new ChatScheduleService(db, async () => ({ reply: "ok", tokensUsed: 0, cost: 0 }));
    goals = new ChatGoalService(db, async () => ({ reply: "ok", tokensUsed: 0, cost: 0 }));
    proposals = new ChatProposalService(db, {
      getConfig: (id) => getChatSession(db, id)?.agentConfig ?? null,
      patchConfig: (id, patch) => svc.updateSessionConfig(id, patch),
      isBusy: (id) => svc.isBusy(id),
      schedules,
      goals,
      providers: () => ["test"],
      models: async () => ["test-model"],
      skills: () => ({ names: [], paths: [] }),
    });
    svc.attachSessionControl(proposals);
  });
  afterEach(async () => {
    schedules.dispose();
    goals.dispose();
    await svc.disposeAll();
    db.close();
  });

  // A long task skips the tool-relevance classifier, which would otherwise eat the first scripted turn.
  const TASK = `${"Please keep this conversation going with a long preamble. ".repeat(6)}check crypto prices every hour`;
  const scenario = [
    { toolCall: { name: "session-control", args: { action: "set-loop", interval: "1h", prompt: "check crypto" } } },
    { text: "Proposed a loop; please Apply." },
  ];
  const base = { provider: "test", model: "test-model", strategy: "reactive", maxIterations: 6, testScenario: scenario };

  it("agentControl on: the model's tool call records a proposal and changes nothing else", async () => {
    const id = await svc.createSession({ name: "ctl", agentConfig: { ...base, agentControl: true } });
    for await (const _ of svc.chatStream(id, TASK)) void _;
    const list = proposals.list(id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ action: "set-loop", status: "proposed", args: { interval: "1h", prompt: "check crypto" } });
    expect(schedules.list(id)).toHaveLength(0);
  }, 30_000);

  it("agentControl off (default): the tool does not exist, so nothing is proposed", async () => {
    const id = await svc.createSession({ name: "plain", agentConfig: { ...base, enableTools: true } });
    for await (const _ of svc.chatStream(id, TASK)) void _;
    expect(proposals.list(id)).toHaveLength(0);
    expect(schedules.list(id)).toHaveLength(0);
  }, 30_000);

  it("agentControl is stored only as a literal true", async () => {
    const id = await svc.createSession({ name: "n", agentConfig: { provider: "test", agentControl: "yes" } });
    expect(getChatSession(db, id)?.agentConfig.agentControl).toBeUndefined();
    await svc.updateSessionConfig(id, { agentControl: true });
    expect(getChatSession(db, id)?.agentConfig.agentControl).toBe(true);
  });
});
