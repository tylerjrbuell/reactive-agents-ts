// Continue as a live turn (services/chat-resume-stream.ts, ChatResume.startStream): the thread
// gets the run's progress while it works, then its end; the exchange is stored before the end.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { RunStoreLive, RunStoreService, type AgentResult, type AgentStreamEvent } from "@reactive-agents/runtime";
import { ChatResume, type ChatResumeHost, type ResumableAgent } from "../services/chat-resume.js";
import { resumeEventStream, resumeProgressEvent, resumeTerminalEvent, type ResumeStreamAgent } from "../services/chat-resume-stream.js";
import { ResumeGuard } from "../services/loop-stop-resume.js";
import { rmTmpDirs, tmpDir } from "./helpers/tmp-db.js";

afterAll(() => rmTmpDirs());

const result = (over: Partial<AgentResult>): AgentResult =>
  ({ output: "all done", success: true, taskId: "t1", agentId: "chat-1", metadata: { duration: 1, cost: 0, tokensUsed: 5, stepsCount: 2 }, ...over }) as AgentResult;

const bus = {
  iteration: (n: number): AgentEvent => ({ _tag: "ReasoningIterationProgress", taskId: "t1", iteration: n, maxIterations: 8, strategy: "reactive", toolsThisStep: ["web-search"] }),
  started: (callId: string): AgentEvent => ({ _tag: "ToolCallStarted", taskId: "t1", toolName: "web-search", callId, args: { q: "x" } }),
  completed: (callId: string): AgentEvent => ({ _tag: "ToolCallCompleted", taskId: "t1", toolName: "web-search", callId, durationMs: 12, success: true, result: "found" }),
};

/** An agent whose run emits bus events in steps, then ends with `end`. */
function steppedAgent(steps: readonly AgentEvent[], end: () => Promise<AgentResult>): ResumeStreamAgent {
  let handler: ((e: AgentEvent) => void) | undefined;
  let detached = false;
  const agent: ResumeStreamAgent & { readonly detached: () => boolean } = {
    subscribe: async (h) => {
      handler = h;
      return () => {
        detached = true;
      };
    },
    resumeRun: async () => {
      for (const e of steps) {
        await new Promise((r) => setTimeout(r, 2));
        handler?.(e);
      }
      return end();
    },
    detached: () => detached,
  };
  return agent;
}

const drain = async (gen: AsyncGenerator<AgentStreamEvent>): Promise<AgentStreamEvent[]> => {
  const out: AgentStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe("resumeProgressEvent", () => {
  it("projects iteration progress and tool calls like the framework's own stream, and ignores the rest", () => {
    expect(resumeProgressEvent(bus.iteration(3))).toMatchObject({ _tag: "IterationProgress", iteration: 3, maxIterations: 8, toolsCalledThisStep: ["web-search"] });
    expect(resumeProgressEvent(bus.started("c1"))).toEqual({ _tag: "ToolCallStarted", toolName: "web-search", callId: "c1", args: { q: "x" } });
    expect(resumeProgressEvent(bus.completed("c1"))).toMatchObject({ _tag: "ToolCallCompleted", callId: "c1", success: true, result: "found", durationMs: 12 });
    expect(resumeProgressEvent({ _tag: "AgentStarted", taskId: "t1", agentId: "a", provider: "p", model: "m", timestamp: 0 } as AgentEvent)).toBeUndefined();
  });

  it("caps a long tool result", () => {
    const e = resumeProgressEvent({ ...bus.completed("c"), result: "x".repeat(9_000) } as AgentEvent);
    expect(e).toMatchObject({ _tag: "ToolCallCompleted", resultTruncated: true });
    expect(e?._tag === "ToolCallCompleted" ? e.result?.length : 0).toBe(8_000);
  });
});

describe("resumeTerminalEvent", () => {
  it("reads a user stop and a user pause as the cancelled turn they are", () => {
    const stopped = result({ success: false, stop: { kind: "user-stopped" } } as Partial<AgentResult>);
    const paused = result({ success: false, stop: { kind: "user-paused" } } as Partial<AgentResult>);
    expect(resumeTerminalEvent(stopped, 4)).toEqual({ _tag: "StreamCancelled", reason: "user", iterationsCompleted: 4 });
    expect(resumeTerminalEvent(paused, 4)).toEqual({ _tag: "StreamCancelled", reason: "user-paused", iterationsCompleted: 4 });
  });

  it("carries a finished or failed run's own outcome on a completion", () => {
    expect(resumeTerminalEvent(result({}), 1)).toMatchObject({ _tag: "StreamCompleted", output: "all done", success: true });
    expect(resumeTerminalEvent(result({ success: false, output: "", error: "budget spent" }), 1)).toMatchObject({ _tag: "StreamCompleted", success: false, error: "budget spent" });
  });
});

describe("resumeEventStream", () => {
  it("yields progress while the run works, then the terminal event, after the result was handed over", async () => {
    const settled: string[] = [];
    const agent = steppedAgent([bus.iteration(1), bus.started("c1"), bus.completed("c1")], async () => result({}));
    const events: AgentStreamEvent[] = [];
    for await (const e of resumeEventStream(agent, "run-1", undefined, () => settled.push("settled"))) {
      // The exchange is handed over before the end reaches the client.
      if (e._tag === "StreamCompleted") expect(settled).toEqual(["settled"]);
      events.push(e);
    }
    expect(events.map((e) => e._tag)).toEqual(["IterationProgress", "ToolCallStarted", "ToolCallCompleted", "StreamCompleted"]);
    expect((agent as unknown as { detached: () => boolean }).detached()).toBe(true);
  });

  it("ends with StreamError when the framework refuses the run", async () => {
    const agent = steppedAgent([], async () => {
      throw new Error("RunNotResumable: nope");
    });
    const events = await drain(resumeEventStream(agent, "run-1", undefined, () => {}));
    expect(events).toEqual([{ _tag: "StreamError", cause: "RunNotResumable: nope" }]);
  });

  it("still ends with the result when the agent has no event bus", async () => {
    const events = await drain(resumeEventStream({ resumeRun: async () => result({}) }, "run-1", undefined, () => {}));
    expect(events.map((e) => e._tag)).toEqual(["StreamCompleted"]);
  });
});

describe("ChatResume.startStream", () => {
  const seed = (dir: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* RunStoreService;
        yield* store.createRun({ runId: "r1", agentId: "chat-1", task: "t", configHash: "h" });
        yield* store.setStop("r1", { reason: "user", toolsDone: [], unfinished: [], iteration: 2, kind: "user-stopped" });
        yield* store.setStatus("r1", "stopped");
      }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
    );

  const build = (dir: string, agent: ResumableAgent) => {
    const persisted: { userMessage: string; reply: string }[] = [];
    const evicted: string[] = [];
    let released = 0;
    const host: ChatResumeHost = {
      liveAgentOf: () => undefined,
      durableSourceOf: (id) => (id === "s1" ? { agentId: "chat-1", dir } : undefined),
      acquireTurn: () => () => {
        released += 1;
      },
      agentFor: async () => agent,
      persistExchange: (_s, userMessage, reply) => void persisted.push({ userMessage, reply }),
      evict: async (id) => void evicted.push(id),
    };
    return { resume: new ChatResume(host, new ResumeGuard()), persisted, evicted, released: () => released };
  };

  const control = { activeRunIds: () => [] as string[], pauseRun: async () => false, stopRun: async () => false };

  it("streams the continued run, stores the exchange, then releases the turn", async () => {
    const dir = tmpDir("resume-stream");
    await seed(dir);
    const agent = steppedAgent([bus.started("c1"), bus.completed("c1")], async () => result({ output: "finished" }));
    const h = build(dir, { ...control, resumeRun: agent.resumeRun, subscribe: agent.subscribe } as ResumableAgent);
    const out = await h.resume.startStream("s1", "r1", { ok: true, options: { note: "go on" } });
    if (!out.ok) throw new Error("expected a started stream");
    expect(out.message).toBe("Continue: go on");
    expect(h.released()).toBe(0); // held while the run works
    const events = await drain(out.events);
    expect(events.map((e) => e._tag)).toEqual(["ToolCallStarted", "ToolCallCompleted", "StreamCompleted"]);
    expect(h.persisted).toEqual([{ userMessage: "Continue: go on", reply: "finished" }]);
    expect(h.evicted).toEqual(["s1"]);
    expect(h.released()).toBe(1);
  });

  it("refuses a run that is not an interrupted run of this chat, without starting it", async () => {
    const dir = tmpDir("resume-stream-no");
    await seed(dir);
    let called = false;
    const h = build(dir, { ...control, resumeRun: async () => ((called = true), result({})) } as ResumableAgent);
    const out = await h.resume.startStream("s1", "nope", { ok: true, options: {} });
    expect(out).toMatchObject({ ok: false, code: "not-resumable" });
    expect(called).toBe(false);
    expect(h.released()).toBe(0);
  });

  it("stores nothing and ends with StreamError when the framework refuses", async () => {
    const dir = tmpDir("resume-stream-err");
    await seed(dir);
    const h = build(dir, { ...control, resumeRun: async () => Promise.reject(new Error("boom")) } as ResumableAgent);
    const out = await h.resume.startStream("s1", "r1", { ok: true, options: {} });
    if (!out.ok) throw new Error("expected a started stream");
    expect((await drain(out.events)).map((e) => e._tag)).toEqual(["StreamError"]);
    expect(h.persisted).toEqual([]);
    expect(h.released()).toBe(1);
  });
});
