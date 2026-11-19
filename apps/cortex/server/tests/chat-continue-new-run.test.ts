// Continue is a NEW run linked to its parent (framework resumeRun({ newRun: true })):
//  - chat Continue (blocking and live) asks for newRun and keeps the person's note / step grant,
//  - the turn it lands is stamped with the new run id and `continuedFrom`, and reads back so,
//  - the parent (left resumable by the framework) is no longer offered beside its child,
//  - ingest files the continuation under its own run row, linked by AgentStarted.config.continuedFrom,
//  - older turns and runs without a link read exactly as before.
import { afterAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { RunStoreLive, RunStoreService, type AgentResult } from "@reactive-agents/runtime";
import { ChatResume, continueOptions, type ChatResumeHost, type ResumableAgent } from "../services/chat-resume.js";
import { ResumeGuard } from "../services/loop-stop-resume.js";
import { withContinuedFrom, type StoredTurnTrace } from "../services/chat-turn-trace.js";
import { CortexIngestService, CortexIngestServiceLive, continuedFromOf } from "../services/ingest-service.js";
import { CortexEventBridgeLive } from "../services/event-bridge.js";
import { applySchema } from "../db/schema.js";
import { appendChatTurn, createChatSession, getChatTurns } from "../db/chat-queries.js";
import { getRecentRuns, getRunById } from "../db/queries.js";
import { rmTmpDirs, tmpDir } from "./helpers/tmp-db.js";

afterAll(() => rmTmpDirs());

const STOP = { reason: "loop_detected:repeat", toolsDone: [], unfinished: [], iteration: 4, kind: "user-stopped" as const };

const seed = (dir: string, runs: readonly { runId: string; continuedFrom?: string }[]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* RunStoreService;
      for (const r of runs) {
        yield* store.createRun({ runId: r.runId, agentId: "chat-1", task: `task of ${r.runId}`, configHash: "h", ...(r.continuedFrom ? { continuedFrom: r.continuedFrom } : {}) });
        yield* store.setStop(r.runId, STOP);
        yield* store.setStatus(r.runId, "stopped");
      }
    }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
  );

const continuation = (over: Partial<AgentResult> = {}): AgentResult =>
  ({
    output: "carried on",
    success: true,
    taskId: "parent-cont-aaaaaaaa",
    runId: "parent-cont-aaaaaaaa",
    continuedFrom: "parent",
    agentId: "chat-1",
    metadata: { duration: 1, cost: 0, tokensUsed: 5, stepsCount: 1 },
    ...over,
  }) as AgentResult;

const harness = (dir: string, resumeRun: ResumableAgent["resumeRun"]) => {
  const persisted: { result: AgentResult; trace: StoredTurnTrace | undefined }[] = [];
  const agent: ResumableAgent = { resumeRun, activeRunIds: () => [], pauseRun: async () => false, stopRun: async () => false };
  const host: ChatResumeHost = {
    liveAgentOf: () => undefined,
    durableSourceOf: () => ({ agentId: "chat-1", dir }),
    acquireTurn: () => () => {},
    agentFor: async () => agent,
    persistExchange: (_s, _u, _r, result, _t, trace) => {
      persisted.push({ result, trace });
    },
    evict: async () => {},
  };
  return { resume: new ChatResume(host, new ResumeGuard()), persisted };
};

describe("Continue starts a new, linked run", () => {
  it("continueOptions adds newRun and keeps the note and step grant", () => {
    expect(continueOptions({ note: "go on", extraIterations: 7 })).toEqual({ note: "go on", extraIterations: 7, newRun: true });
    expect(continueOptions({})).toEqual({ newRun: true });
  });

  it("blocking Continue asks for newRun and stamps the turn with the new run id and its parent", async () => {
    const dir = tmpDir("cont-new-run");
    await seed(dir, [{ runId: "parent" }]);
    const seen: unknown[] = [];
    const h = harness(dir, async (_id, options) => {
      seen.push(options);
      return continuation();
    });
    const out = await h.resume.resume("s1", "parent", { ok: true, options: { note: "go on" } });
    expect(out).toMatchObject({ ok: true, success: true });
    expect(seen).toEqual([{ note: "go on", newRun: true }]);
    expect(h.persisted[0]!.trace?.continuedFrom).toBe("parent");
    expect(h.persisted[0]!.result.taskId).toBe("parent-cont-aaaaaaaa");
  });

  it("live Continue (startStream) takes the same path", async () => {
    const dir = tmpDir("cont-new-run-stream");
    await seed(dir, [{ runId: "parent" }]);
    const seen: unknown[] = [];
    const h = harness(dir, async (_id, options) => {
      seen.push(options);
      return continuation();
    });
    const started = await h.resume.startStream("s1", "parent", { ok: true, options: {} });
    if (!started.ok) throw new Error("expected the stream to start");
    for await (const _ of started.events) void _;
    expect(seen).toEqual([{ newRun: true }]);
    expect(h.persisted[0]!.trace?.continuedFrom).toBe("parent");
  });

  it("a continuation that is interrupted again keeps its failed outcome beside the link", async () => {
    const dir = tmpDir("cont-new-run-again");
    await seed(dir, [{ runId: "parent" }]);
    const h = harness(dir, async () => continuation({ success: false, output: "", error: "loop detected", resumable: true }));
    await h.resume.resume("s1", "parent", { ok: true, options: {} });
    expect(h.persisted[0]!.trace).toMatchObject({ continuedFrom: "parent", outcome: { success: false, ending: "failed" } });
  });

  it("the parent is not offered again once it has a continuation; the child is", async () => {
    const dir = tmpDir("cont-new-run-list");
    await seed(dir, [{ runId: "parent" }, { runId: "parent-cont-aaaaaaaa", continuedFrom: "parent" }, { runId: "other" }]);
    const h = harness(dir, async () => continuation());
    const runs = await h.resume.list("s1");
    expect(runs.map((r) => r.runId).sort()).toEqual(["other", "parent-cont-aaaaaaaa"]);
    expect(runs.find((r) => r.runId === "parent-cont-aaaaaaaa")?.continuedFrom).toBe("parent");
    expect(await h.resume.resume("s1", "parent", { ok: true, options: {} })).toMatchObject({ ok: false, code: "not-resumable" });
  });

  it("an ordinary (unlinked) result stamps nothing", () => {
    expect(withContinuedFrom(undefined, undefined)).toBeUndefined();
    expect(withContinuedFrom(undefined, "")).toBeUndefined();
    const t = withContinuedFrom(undefined, "p");
    expect(t).toEqual({ reasoningSteps: [], toolCalls: [], continuedFrom: "p" });
  });
});

describe("the stored chat turn carries the link", () => {
  it("reads the continuing turn back with run id and continuedFrom; a legacy turn has neither link", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const sessionId = createChatSession(db, { agentConfig: {} });
    appendChatTurn(db, { sessionId, role: "user", content: "Continue", tokensUsed: 0 });
    appendChatTurn(db, { sessionId, role: "assistant", content: "carried on", tokensUsed: 5, runId: "parent-cont-aaaaaaaa", trace: withContinuedFrom(undefined, "parent")! });
    appendChatTurn(db, { sessionId, role: "assistant", content: "older reply", tokensUsed: 1, runId: "old-run" });
    const [, cont, legacy] = getChatTurns(db, sessionId);
    expect(cont).toMatchObject({ runId: "parent-cont-aaaaaaaa", continuedFrom: "parent" });
    expect(legacy?.runId).toBe("old-run");
    expect(legacy && "continuedFrom" in legacy).toBe(false);
  });
});

describe("ingest links a continuation's run row to its parent", () => {
  const send = (db: Database, runId: string, event: Record<string, unknown>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CortexIngestService;
        yield* svc.handleEvent("chat-1", runId, { v: 1, agentId: "chat-1", runId, event: event as never });
      }).pipe(Effect.provide(CortexIngestServiceLive(db).pipe(Layer.provide(CortexEventBridgeLive)))),
    );

  it("continuedFromOf reads AgentStarted.config.continuedFrom only", () => {
    expect(continuedFromOf({ _tag: "AgentStarted", config: { continuedFrom: "p" } } as never)).toBe("p");
    expect(continuedFromOf({ _tag: "AgentStarted", config: {} } as never)).toBeUndefined();
    expect(continuedFromOf({ _tag: "AgentStarted" } as never)).toBeUndefined();
  });

  it("files the continuation as its own run with continuedFrom; the parent row and unlinked runs stay unlinked", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const started = (taskId: string, config: Record<string, unknown>) => ({ _tag: "AgentStarted", taskId, agentId: "chat-1", provider: "test", model: "m", config });
    await send(db, "parent", started("parent", {}));
    await send(db, "parent-cont-aaaaaaaa", started("parent-cont-aaaaaaaa", { continuedFrom: "parent" }));
    expect(getRunById(db, "parent-cont-aaaaaaaa")?.continuedFrom).toBe("parent");
    expect(getRunById(db, "parent")?.continuedFrom).toBeUndefined();
    expect(getRecentRuns(db).map((r) => r.runId).sort()).toEqual(["parent", "parent-cont-aaaaaaaa"]);
  });
});
