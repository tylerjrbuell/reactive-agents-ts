// Chat Continue (services/chat-resume.ts) over a real durable store: a loop-stopped run is
// listed, continued through agent.resumeRun, and lands as the session's next exchange.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { RunNotResumableError, RunStoreLive, RunStoreService, type AgentResult } from "@reactive-agents/runtime";
import { ChatResume, type ChatResumeHost, type ResumableAgent } from "../services/chat-resume.js";
import { ResumeGuard } from "../services/loop-stop-resume.js";
import type { StoredTurnTrace } from "../services/chat-turn-trace.js";
import { rmTmpDirs, tmpDir } from "./helpers/tmp-db.js";

afterAll(() => rmTmpDirs());

const STOP = { reason: "loop_detected:repeat", repeatedTool: "web-search", toolsDone: [{ tool: "web-search", calls: 3 }], unfinished: ["write report"], iteration: 7 };

const seed = (dir: string, runs: readonly { runId: string; agentId: string; stopped: boolean }[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      for (const r of runs) {
        yield* store.createRun({ runId: r.runId, agentId: r.agentId, task: `task of ${r.runId}`, configHash: "h" });
        if (r.stopped) yield* store.setLoopStop(r.runId, STOP);
      }
    }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
  );

const result = (over: Partial<AgentResult>): AgentResult =>
  ({
    output: "all done",
    success: true,
    taskId: "t1",
    agentId: "chat-1",
    metadata: { duration: 1, cost: 0.01, tokensUsed: 50, stepsCount: 3 },
    ...over,
  }) as AgentResult;

interface Harness {
  readonly resume: ChatResume;
  readonly calls: { runId: string; options: unknown }[];
  readonly persisted: { sessionId: string; userMessage: string; reply: string; trace: StoredTurnTrace | undefined }[];
  readonly evicted: string[];
  setAgent(agent: ResumableAgent): void;
}

const harness = (dir: string, opts: { busy?: boolean; agentId?: string | undefined } = {}): Harness => {
  const calls: Harness["calls"] = [];
  const persisted: Harness["persisted"] = [];
  const evicted: string[] = [];
  let agent: ResumableAgent = {
    resumeRun: async (runId, options) => {
      calls.push({ runId, options });
      return result({});
    },
  };
  const host: ChatResumeHost = {
    durableSourceOf: (id) => (id === "s1" && opts.agentId !== undefined ? { agentId: opts.agentId, dir } : id === "s1" ? { agentId: "chat-1", dir } : undefined),
    acquireTurn: () => {
      if (opts.busy) throw new Error("A turn is already running");
      return () => {};
    },
    agentFor: async () => agent,
    persistExchange: (sessionId, userMessage, reply, _r, _t, trace) => {
      persisted.push({ sessionId, userMessage, reply, trace });
    },
    evict: async (id) => {
      evicted.push(id);
    },
  };
  return { resume: new ChatResume(host, new ResumeGuard()), calls, persisted, evicted, setAgent: (a) => (agent = a) };
};

describe("ChatResume.list", () => {
  it("lists only the session agent's loop-stopped runs, from the durable store", async () => {
    const dir = tmpDir("chat-resume");
    await seed(dir, [
      { runId: "mine-stopped", agentId: "chat-1", stopped: true },
      { runId: "mine-plain", agentId: "chat-1", stopped: false },
      { runId: "other-agent", agentId: "chat-2", stopped: true },
    ]);
    const h = harness(dir);
    const runs = await h.resume.list("s1");
    expect(runs.map((r) => r.runId)).toEqual(["mine-stopped"]);
    expect(runs[0]!.loopStop).toEqual(STOP);
  });

  it("is empty with no store, an unknown session, or a session without a stable agent id", async () => {
    const empty = tmpDir("chat-resume-empty");
    expect(await harness(empty).resume.list("s1")).toEqual([]);
    expect(await harness(empty).resume.list("nope")).toEqual([]);
  });
});

describe("ChatResume.resume", () => {
  it("continues a loop-stopped run with the note and iteration grant and lands the reply as the next exchange", async () => {
    const dir = tmpDir("chat-resume-ok");
    await seed(dir, [{ runId: "r1", agentId: "chat-1", stopped: true }]);
    const h = harness(dir);
    const out = await h.resume.resume("s1", "r1", { ok: true, options: { note: "skip the PDF", extraIterations: 12 } });
    expect(out).toEqual({ ok: true, reply: "all done", success: true, resumable: false });
    expect(h.calls).toEqual([{ runId: "r1", options: { note: "skip the PDF", extraIterations: 12 } }]);
    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0]).toMatchObject({ sessionId: "s1", userMessage: "Continue: skip the PDF", reply: "all done" });
    expect(h.persisted[0]!.trace).toBeUndefined();
    expect(h.evicted).toEqual(["s1"]);
  });

  it("stores a run that stops on a loop guard again as a failed turn and reports it resumable", async () => {
    const dir = tmpDir("chat-resume-again");
    await seed(dir, [{ runId: "r1", agentId: "chat-1", stopped: true }]);
    const h = harness(dir);
    h.setAgent({
      resumeRun: async () => result({ success: false, output: "", error: "loop detected", resumable: true, loopStop: STOP }),
    });
    const out = await h.resume.resume("s1", "r1", { ok: true, options: {} });
    expect(out).toMatchObject({ ok: true, success: false, resumable: true });
    expect(h.persisted[0]!.userMessage).toBe("Continue");
    expect(h.persisted[0]!.trace?.outcome).toMatchObject({ success: false, ending: "failed" });
  });

  it("refuses a run that is not loop-stopped in this chat without calling the framework", async () => {
    const dir = tmpDir("chat-resume-not");
    await seed(dir, [{ runId: "plain", agentId: "chat-1", stopped: false }]);
    const h = harness(dir);
    const out = await h.resume.resume("s1", "plain", { ok: true, options: {} });
    expect(out).toMatchObject({ ok: false, code: "not-resumable" });
    expect(h.calls).toEqual([]);
    expect(h.persisted).toEqual([]);
  });

  it("maps RunNotResumableError from the framework to a 4xx outcome and persists nothing", async () => {
    const dir = tmpDir("chat-resume-err");
    await seed(dir, [{ runId: "r1", agentId: "chat-1", stopped: true }]);
    const h = harness(dir);
    h.setAgent({
      resumeRun: async (runId) => {
        throw new RunNotResumableError({ runId, reason: "already continued" });
      },
    });
    const out = await h.resume.resume("s1", "r1", { ok: true, options: {} });
    expect(out).toMatchObject({ ok: false, code: "not-resumable" });
    expect(h.persisted).toEqual([]);
    expect(h.evicted).toEqual([]);
  });

  it("is busy while a turn is in flight", async () => {
    const dir = tmpDir("chat-resume-busy");
    await seed(dir, [{ runId: "r1", agentId: "chat-1", stopped: true }]);
    const h = harness(dir, { busy: true });
    expect(await h.resume.resume("s1", "r1", { ok: true, options: {} })).toMatchObject({ ok: false, code: "busy" });
    expect(h.calls).toEqual([]);
  });

  it("refuses a repeated tap while the first Continue is still running, then allows it again", async () => {
    const dir = tmpDir("chat-resume-tap");
    await seed(dir, [{ runId: "r1", agentId: "chat-1", stopped: true }]);
    const h = harness(dir);
    let finish: (r: AgentResult) => void = () => {};
    h.setAgent({
      resumeRun: () =>
        new Promise<AgentResult>((resolve) => {
          finish = resolve;
        }),
    });
    const first = h.resume.resume("s1", "r1", { ok: true, options: {} });
    await new Promise((r) => setTimeout(r, 30));
    const second = await h.resume.resume("s1", "r1", { ok: true, options: {} });
    expect(second).toMatchObject({ ok: false, code: "busy" });
    finish(result({}));
    expect(await first).toMatchObject({ ok: true });
    expect(h.persisted).toHaveLength(1);
  });
});
