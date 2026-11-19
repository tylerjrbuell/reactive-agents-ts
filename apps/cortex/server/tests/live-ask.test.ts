// Run: bun test apps/cortex/server/tests/live-ask.test.ts --timeout 30000
//
// `request_user_input` without durable runs (runtime e4877472f): the question waits
// LIVE in process. A chat turn streams `InteractionRequested`; the desk registry lists
// the question (with its chat session) and answers it; the same run goes on with the
// answer. A desk run is listed and answered through the runner. No durable store anywhere.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import type { ChatStreamEvent as AgentStreamEvent } from "../services/chat-detached-turn.js";
import { Effect, Layer } from "effect";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexRunnerService, CortexRunnerServiceLive } from "../services/runner-service.js";
import { applySchema } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { askWaitsLive, durableApprovals, waitsLive, type LiveApprovableAgent } from "../services/durable-approvals.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";

let db: Database;
let svc: ChatSessionService;

beforeAll(() => {
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(async () => {
  await svc.disposeAll();
  db.close();
});

const ASK = {
  toolCall: { name: "request_user_input", args: { kind: "choice", prompt: "Which option?", schema: { options: ["red", "blue"] } } },
};
const SCENARIO = [ASK, { match: "blue", text: "You picked blue. FINAL." }, { text: "fallback" }];

describe("askWaitsLive", () => {
  it("is true when the agent may ask and there are no durable runs", () => {
    expect(askWaitsLive({ rawConfig: { userInteraction: true } })).toBe(true);
    expect(askWaitsLive({ rawConfig: { userInteraction: { timeoutMs: 5000 } } })).toBe(true);
    expect(askWaitsLive({ rawConfig: { userInteraction: false } })).toBe(false);
    expect(askWaitsLive({ rawConfig: { userInteraction: true }, durableRuns: { enabled: true } })).toBe(false);
    expect(askWaitsLive({})).toBe(false);
    expect(waitsLive({ rawConfig: { userInteraction: true } })).toBe(true);
    expect(waitsLive({ approvalPolicy: { mode: "detach" } })).toBe(true);
  });

  it("userInteraction rides the AgentConfig: durable keeps its own, rawConfig wins", () => {
    expect(cortexParamsToAgentConfig({ provider: "test", durableRuns: { enabled: true } }).userInteraction).toBe(true);
    expect(
      cortexParamsToAgentConfig({ provider: "test", durableRuns: { enabled: true }, rawConfig: { userInteraction: { timeoutMs: 9000 } } }).userInteraction,
    ).toEqual({ timeoutMs: 9000 });
    expect(cortexParamsToAgentConfig({ provider: "test", rawConfig: { userInteraction: true } }).userInteraction).toBe(true);
    expect(cortexParamsToAgentConfig({ provider: "test" }).userInteraction).toBeUndefined();
  });
});

describe("durableApprovals live interactions", () => {
  it("lists a source's questions with agent and chat session, answers them, forgets an unwatched source", async () => {
    const answers: string[] = [];
    const agent = {
      listPendingApprovals: async () => [],
      approveRun: async () => ({}) as never,
      denyRun: async () => ({}) as never,
      listPendingInteractions: async () => [
        { runId: "r1", interactionId: "i1", kind: "choice", prompt: "Which?", schema: { options: ["a"] }, task: "", updatedAt: 0 },
      ],
      respondToInteraction: async (runId: string, interactionId: string, value: unknown) => {
        answers.push(`${runId}:${interactionId}:${String(value)}`);
        return {} as never;
      },
    } as unknown as LiveApprovableAgent;
    const unwatch = durableApprovals.watchLive({ agentId: "chat-agent", agent, chatSessionId: "s1" });
    try {
      expect(await durableApprovals.listLiveInteractions()).toEqual([
        { runId: "r1", interactionId: "i1", kind: "choice", prompt: "Which?", schema: { options: ["a"] }, agentId: "chat-agent", chatSessionId: "s1" },
      ]);
      expect(await durableApprovals.answerLiveInteraction("r1", "i1", "a")).toEqual({ ok: true });
      expect(answers).toEqual(["r1:i1:a"]);
      expect((await durableApprovals.answerLiveInteraction("r1", "wrong", "a")).ok).toBe(false);
      expect((await durableApprovals.answerLiveInteraction("nope", "i1", "a")).ok).toBe(false);
    } finally {
      unwatch();
    }
    expect(await durableApprovals.listLiveInteractions()).toEqual([]);
    expect((await durableApprovals.answerLiveInteraction("r1", "i1", "a")).ok).toBe(false);
  });
});

describe("a chat turn asking a question live (no durable runs)", () => {
  it("streams the question, the desk answers it, and the same turn finishes with the answer", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", strategy: "reactive", maxIterations: 4, tools: ["file-read"], durableRuns: { enabled: false }, testScenario: SCENARIO } });
    const events: AgentStreamEvent[] = [];
    for await (const ev of svc.chatStream(id, "help me choose")) {
      events.push(ev);
      if (ev._tag === "InteractionRequested") {
        const listed = (await durableApprovals.listLiveInteractions()).find((r) => r.interactionId === ev.interactionId);
        expect(listed).toMatchObject({ kind: "choice", prompt: "Which option?", chatSessionId: id });
        expect(await durableApprovals.answerLiveInteraction(ev.runId, ev.interactionId, "blue")).toEqual({ ok: true });
      }
    }
    const asked = events.find((e) => e._tag === "InteractionRequested");
    expect(asked).toMatchObject({ kind: "choice", prompt: "Which option?" });
    const done = events.find((e): e is Extract<AgentStreamEvent, { _tag: "StreamCompleted" }> => e._tag === "StreamCompleted");
    expect(done?.pendingInteraction).toBeUndefined();
    expect(done?.output).toContain("You picked blue");
    // Nothing is held off-thread: the exchange is an ordinary turn.
    expect(svc.getSession(id)!.pendingInteractions).toEqual([]);
    await svc.deleteSession(id);
  }, 30_000);

  it("a chat can be told not to ask: rawConfig.userInteraction false removes the question rail", async () => {
    const id = await svc.createSession({
      agentConfig: { provider: "test", strategy: "reactive", maxIterations: 3, tools: ["file-read"], rawConfig: { userInteraction: false }, testScenario: SCENARIO },
    });
    const events: AgentStreamEvent[] = [];
    for await (const ev of svc.chatStream(id, "help me choose")) events.push(ev);
    expect(events.some((e) => e._tag === "InteractionRequested")).toBe(false);
    await svc.deleteSession(id);
  }, 30_000);
});

describe("a desk run asking a question live (no durable runs)", () => {
  it("is listed by the runner, answered by it, and the same run finishes", async () => {
    const runDb = new Database(":memory:");
    applySchema(runDb);
    const ingest = Layer.succeed(CortexIngestService, { handleEvent: () => Effect.void, getSubscriberCount: () => Effect.succeed(0) });
    const layer = CortexRunnerServiceLive.pipe(Layer.provide(Layer.merge(CortexStoreServiceLive(runDb), ingest)));
    const program = Effect.gen(function* () {
      const runner = yield* CortexRunnerService;
      const { runId } = yield* runner.start({
        provider: "test",
        prompt: "help me choose",
        strategy: "reactive",
        maxIterations: 4,
        rawConfig: { userInteraction: true },
        testScenario: SCENARIO,
      } as never);
      let listed = yield* runner.listPendingInteractions();
      for (let i = 0; i < 100 && listed.length === 0; i++) {
        listed = yield* runner.listPendingInteractions();
        if (listed.length === 0) yield* Effect.sleep("50 millis");
      }
      expect(listed.map((r) => [r.kind, r.prompt])).toEqual([["choice", "Which option?"]]);
      const answered = yield* runner.respondToInteraction(listed[0]!.runId as never, listed[0]!.interactionId, "blue");
      expect(answered.success).toBe(true);
      for (let i = 0; i < 100 && (yield* runner.getActive()).has(runId); i++) yield* Effect.sleep("50 millis");
      expect(yield* runner.listPendingInteractions()).toEqual([]);
    });
    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  }, 30_000);
});
