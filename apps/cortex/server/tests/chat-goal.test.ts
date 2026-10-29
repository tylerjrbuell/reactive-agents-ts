import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { createChatSession } from "../db/chat-queries.js";
import {
  ChatGoalService,
  parseVerdict,
  segmentPrompt,
  type GoalRubricChecker,
} from "../services/chat-goal-service.js";
import { ChatSessionBusyError, type CortexChatResult } from "../services/chat-session-service.js";
import { chatRouter } from "../api/chat.js";
import type { ChatSessionService } from "../services/chat-session-service.js";

const regexDone = { kind: "regex", pattern: "DONE" } as const;

describe("chat goals", () => {
  let db: Database;
  let sid: string;
  let prompts: string[];
  let replies: Array<() => Promise<CortexChatResult>>;
  let verdicts: Array<ReturnType<GoalRubricChecker> extends Promise<infer V> ? V : never>;
  let svc: ChatGoalService;

  const turn = (reply: string, extra: Partial<CortexChatResult> = {}) => async (): Promise<CortexChatResult> => ({
    reply,
    tokensUsed: 10,
    cost: 0.01,
    ...extra,
  });

  beforeEach(() => {
    db = new Database(":memory:");
    applySchema(db);
    sid = createChatSession(db, { agentConfig: { provider: "test" } });
    prompts = [];
    replies = [];
    verdicts = [];
    svc = new ChatGoalService(
      db,
      async (_s, m) => {
        prompts.push(m);
        const next = replies.shift() ?? turn("noop");
        return next();
      },
      { checker: async () => verdicts.shift() ?? null },
    );
  });

  const propose = (over: Partial<Parameters<ChatGoalService["propose"]>[1]> = {}) => {
    const r = svc.propose(sid, { objective: "ship it", criteria: [{ text: "says DONE", check: regexDone }], ...over });
    if (!r.ok) throw new Error(r.message);
    return r.goal;
  };

  it("proposes with default budget and a derived rubric criterion when none given", () => {
    const r = svc.propose(sid, { objective: "make it great" });
    if (!r.ok) throw new Error(r.message);
    expect(r.goal.status).toBe("proposed");
    expect(r.goal.budget).toEqual({ maxSegments: 5, maxCostUsd: 1 });
    expect(r.goal.criteria).toEqual([{ id: "c1", text: "make it great", check: { kind: "rubric" } }]);
    expect(svc.activeGoal(sid)).toBeNull();
    expect(prompts).toHaveLength(0); // a proposal runs nothing
  });

  it("rejects invalid input and unknown sessions", () => {
    expect(svc.propose(sid, { objective: "  " }).ok).toBe(false);
    expect(svc.propose("nope", { objective: "x" })).toMatchObject({ ok: false, code: "not-found" });
    expect(svc.propose(sid, { objective: "x", criteria: [{ text: "t", check: { kind: "regex", pattern: "(" } }] })).toMatchObject({ ok: false, code: "invalid" });
    expect(svc.propose(sid, { objective: "x", budget: { maxSegments: 0 } })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("accept runs segments until the regex criterion passes: achieved", async () => {
    replies = [turn("working"), turn("all DONE")];
    propose();
    const r = svc.accept(sid);
    expect(r.ok && r.goal.status).toBe("active");
    expect(svc.activeGoal(sid)?.objective).toBe("ship it");
    await svc.settled(sid);
    const rec = svc.get(sid)!;
    expect(rec.goal.status).toBe("achieved");
    expect(rec.goalAchieved).toBe(true);
    expect(rec.goal.segments).toBe(2);
    expect(rec.goal.spent.costUsd).toBeCloseTo(0.02);
    expect(prompts[0]).toContain("Goal: ship it");
    expect(prompts[0]).toContain("says DONE");
    expect(prompts[0]).toContain("Continue toward the goal");
    expect(svc.activeGoal(sid)).toBeNull();
  });

  it("rubric-only goal with a passing checker verdict is achieved; with no verdict it is never claimed", async () => {
    replies = [turn("did it")];
    verdicts = ["achieved"];
    svc.propose(sid, { objective: "write haiku", budget: { maxSegments: 1 } });
    svc.accept(sid);
    await svc.settled(sid);
    expect(svc.get(sid)!.goal.status).toBe("achieved");

    // second goal: checker undecided -> budget runs out, goalAchieved stays null/false, never true
    replies = [turn("hmm")];
    svc.propose(sid, { objective: "write poem", budget: { maxSegments: 1 } });
    svc.accept(sid);
    await svc.settled(sid);
    const rec = svc.get(sid)!;
    expect(rec.goal.status).toBe("budget-exhausted");
    expect(rec.goalAchieved).not.toBe(true);
    expect(rec.goal.verdictHistory).toEqual([null]);
  });

  it("budget exhaustion ends as budget-exhausted", async () => {
    replies = [turn("a", { toolsUsed: ["t"] }), turn("b", { toolsUsed: ["t"] })];
    propose({ budget: { maxSegments: 2 } });
    svc.accept(sid);
    await svc.settled(sid);
    expect(svc.get(sid)!.goal.status).toBe("budget-exhausted");
  });

  it("progressed = tool calls this turn; no-delta turns stall the goal", async () => {
    replies = [turn("a"), turn("b"), turn("c")];
    propose({ budget: { maxSegments: 5 } });
    svc.accept(sid);
    await svc.settled(sid);
    expect(svc.get(sid)!.goal.status).toBe("stalled");

    replies = [turn("a", { toolsUsed: ["web-search"] }), turn("b", { toolsUsed: ["web-search"] }), turn("c DONE", { toolsUsed: ["x"] })];
    propose({ budget: { maxSegments: 5 } });
    svc.accept(sid);
    await svc.settled(sid);
    expect(svc.get(sid)!.goal.status).toBe("achieved");
  });

  it("a throwing segment (e.g. busy session) ends the goal blocked with the reason", async () => {
    replies = [async () => { throw new ChatSessionBusyError(sid); }];
    propose();
    svc.accept(sid);
    await svc.settled(sid);
    const rec = svc.get(sid)!;
    expect(rec.goal.status).toBe("blocked");
    expect(rec.reason).toContain("busy");
  });

  it("pause between segments, then resume continues from saved state", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    replies = [async () => { await gate; return { reply: "step", tokensUsed: 1, cost: 0.01, toolsUsed: ["t"] }; }, turn("DONE")];
    propose();
    svc.accept(sid);
    const p = svc.pause(sid);
    expect(p.ok && p.goal.status).toBe("paused");
    expect(svc.resume(sid)).toMatchObject({ ok: false, code: "conflict" }); // segment still finishing
    release();
    await svc.settled(sid);
    expect(svc.get(sid)!.goal.status).toBe("paused");
    expect(svc.get(sid)!.goal.segments).toBe(1);
    expect(svc.activeGoal(sid)).toBeNull();

    expect(svc.resume(sid).ok).toBe(true);
    await svc.settled(sid);
    const rec = svc.get(sid)!;
    expect(rec.goal.status).toBe("achieved");
    expect(rec.goal.segments).toBe(2);
  });

  it("cancel between segments stops further segments", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    replies = [async () => { await gate; return { reply: "x", tokensUsed: 1, toolsUsed: ["t"] }; }, turn("DONE")];
    propose();
    svc.accept(sid);
    expect(svc.cancel(sid).ok).toBe(true);
    release();
    await svc.settled(sid);
    expect(svc.get(sid)!.goal.status).toBe("cancelled");
    expect(prompts).toHaveLength(1);
    expect(svc.cancel(sid)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("one live goal per session; a finished or proposed goal can be replaced", () => {
    propose();
    expect(propose().status).toBe("proposed"); // replaces the proposal
    svc.accept(sid);
    expect(svc.propose(sid, { objective: "another" })).toMatchObject({ ok: false, code: "conflict" });
  });

  it("boot recovery turns active goals into paused", () => {
    replies = [() => new Promise<CortexChatResult>(() => undefined)]; // never resolves
    propose();
    svc.accept(sid);
    const fresh = new ChatGoalService(db, async () => ({ reply: "", tokensUsed: 0 }), { checker: async () => null });
    expect(fresh.recoverOnBoot()).toBe(1);
    expect(fresh.get(sid)!.goal.status).toBe("paused");
    expect(fresh.activeGoal(sid)).toBeNull();
    svc.dispose();
  });

  it("parseVerdict accepts exactly one verdict word, else null", () => {
    expect(parseVerdict("Achieved.")).toBe("achieved");
    expect(parseVerdict("progressing")).toBe("progressing");
    expect(parseVerdict("achieved or blocked?")).toBeNull();
    expect(parseVerdict("no idea")).toBeNull();
  });

  it("segmentPrompt names objective, criteria and segment budget", () => {
    const g = propose();
    expect(segmentPrompt(g)).toContain("segment 1 of at most 5");
  });

  describe("routes", () => {
    let chatCalls: number;
    const stubSvc = {
      chat: async () => {
        chatCalls += 1;
        return { reply: "hi", tokensUsed: 1 };
      },
      chatStream: async function* () {
        chatCalls += 1;
      },
    } as unknown as ChatSessionService;
    const app = () => new Elysia().use(chatRouter(stubSvc, undefined, svc));
    const call = (method: string, path: string, body?: unknown) =>
      app().handle(
        new Request(`http://localhost/api/chat${path}`, {
          method,
          ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
        }),
      );

    beforeEach(() => {
      chatCalls = 0;
    });

    it("GET returns {goal:null} then the proposal; propose/accept/pause/resume/cancel lifecycle", async () => {
      expect(await (await call("GET", `/sessions/${sid}/goal`)).json()).toMatchObject({ goal: null });
      const proposed = (await (await call("POST", `/sessions/${sid}/goal`, { objective: "ship it", criteria: [{ text: "DONE", check: regexDone }] })).json()) as { goal: { status: string } };
      expect(proposed.goal.status).toBe("proposed");
      expect((await call("POST", `/sessions/${sid}/goal/resume`)).status).toBe(409);
      expect((await call("POST", `/sessions/${sid}/goal/bogus`)).status).toBe(404);
      expect((await call("POST", `/sessions/${sid}/goal/constructor`)).status).toBe(404);
      expect((await call("POST", `/sessions/${sid}/goal`, { objective: "" })).status).toBe(400);
      expect((await call("POST", `/sessions/nope/goal`, { objective: "x" })).status).toBe(404);
      expect((await call("POST", `/sessions/${sid}/goal/cancel`)).status).toBe(200);
      const got = (await (await call("GET", `/sessions/${sid}/goal`)).json()) as { goal: { status: string } };
      expect(got.goal.status).toBe("cancelled");
    });

    it("user turns return 409 naming the goal while it is active, and work again after pause", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      replies = [async () => { await gate; return { reply: "w", tokensUsed: 1, toolsUsed: ["t"] }; }];
      await call("POST", `/sessions/${sid}/goal`, { objective: "ship it", criteria: [{ text: "DONE", check: regexDone }] });
      expect((await call("POST", `/sessions/${sid}/goal/accept`)).status).toBe(200);
      const chat = await call("POST", `/sessions/${sid}/chat`, { message: "hello" });
      expect(chat.status).toBe(409);
      expect(((await chat.json()) as { error: string }).error).toContain("ship it");
      expect((await call("POST", `/sessions/${sid}/chat/stream`, { message: "hello" })).status).toBe(409);
      expect(chatCalls).toBe(0);
      await call("POST", `/sessions/${sid}/goal/pause`);
      release();
      await svc.settled(sid);
      expect((await call("POST", `/sessions/${sid}/chat`, { message: "hello" })).status).toBe(200);
      expect(chatCalls).toBe(1);
    });
  });
});
