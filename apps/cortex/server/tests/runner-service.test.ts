import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexRunnerService, CortexRunnerServiceLive, makeCortexRunnerServiceLive } from "../services/runner-service.js";
import { buildCortexAgent } from "../services/build-cortex-agent.js";

describe("CortexRunnerService", () => {
  it("getActive returns an empty map initially", async () => {
    const db = new Database(":memory:");
    applySchema(db);
    const storeLayer = CortexStoreServiceLive(db);
    // Mock ingest service — runner now requires it at build time
    const mockIngestLayer = Layer.succeed(CortexIngestService, {
      handleEvent: () => Effect.void,
      getSubscriberCount: () => Effect.succeed(0),
    });
    const runnerLayer = CortexRunnerServiceLive.pipe(
      Layer.provide(Layer.merge(storeLayer, mockIngestLayer)),
    );

    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const active = yield* svc.getActive();
      expect(active.size).toBe(0);
    });

    await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
  });
});

describe("CortexRunnerService — terminate (C3)", () => {
  const buildRunner = () => {
    const db = new Database(":memory:");
    applySchema(db);
    const storeLayer = CortexStoreServiceLive(db);
    const mockIngestLayer = Layer.succeed(CortexIngestService, {
      handleEvent: () => Effect.void,
      getSubscriberCount: () => Effect.succeed(0),
    });
    return CortexRunnerServiceLive.pipe(
      Layer.provide(Layer.merge(storeLayer, mockIngestLayer)),
    );
  };

  it("terminate() on an unknown run is a graceful no-op", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      // Must not throw — mirrors pause()/stop() guards.
      yield* svc.terminate("no-such-run" as never);
      const active = yield* svc.getActive();
      expect(active.size).toBe(0);
    });
    await Effect.runPromise(program.pipe(Effect.provide(buildRunner())));
  });

  it("terminate() removes an active run from the registry", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      // start() kicks agent.run() fire-and-forget and returns immediately, so
      // the entry is registered as active before the (test-provider) run settles.
      const { runId } = yield* svc.start({ provider: "test", prompt: "hi" });
      yield* svc.terminate(runId as never);
      const active = yield* svc.getActive();
      expect(active.has(String(runId))).toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(buildRunner())));
  });

  it("terminate() is idempotent — a second call does not throw", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const { runId } = yield* svc.start({ provider: "test", prompt: "hi" });
      yield* svc.terminate(runId as never);
      yield* svc.terminate(runId as never);
      const active = yield* svc.getActive();
      expect(active.has(String(runId))).toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(buildRunner())));
  });
});

describe("CortexRunnerService — desk Stop and Terminate end the run as stopped", () => {
  type Recorded = { readonly runId: string; readonly tag: string; readonly error?: string };
  const recordingRunner = (opts: { stopGraceMs?: number } = {}) => {
    const db = new Database(":memory:");
    applySchema(db);
    const events: Recorded[] = [];
    const ingestLayer = Layer.succeed(CortexIngestService, {
      handleEvent: (_agentId, runId, msg) =>
        Effect.sync(() => {
          const e = msg.event as { _tag: string; error?: unknown };
          events.push({ runId, tag: e._tag, ...(typeof e.error === "string" ? { error: e.error } : {}) });
        }),
      getSubscriberCount: () => Effect.succeed(0),
    });
    const layer = makeCortexRunnerServiceLive(opts).pipe(
      Layer.provide(Layer.merge(CortexStoreServiceLive(db), ingestLayer)),
    );
    return { layer, events };
  };
  // One slow model call: the run sits inside the reasoning phase, where a
  // graceful stop is only seen at the next engine phase boundary.
  const slowRun = { provider: "test", prompt: "slow task", testScenario: [{ text: "late answer", delayMs: 4_000 }] };
  const waitFor = (pred: () => boolean, ms: number) =>
    Effect.gen(function* () {
      const end = Date.now() + ms;
      while (!pred() && Date.now() < end) yield* Effect.sleep("25 millis");
      return pred();
    });
  const STOP_TAGS = new Set(["AgentStopped", "AgentTerminated", "ExecutionCancelled"]);

  it("Terminate: the run ends with AgentTerminated, before any failed AgentCompleted, and never with 'ManagedRuntime disposed'", async () => {
    const { layer, events } = recordingRunner();
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const { runId } = yield* svc.start(slowRun);
      yield* Effect.sleep("300 millis");
      yield* svc.terminate(runId as never);
      const ended = yield* waitFor(() => events.some((e) => e.runId === runId && STOP_TAGS.has(e.tag)), 3_000);
      expect(ended).toBe(true);
      const mine = events.filter((e) => e.runId === runId);
      const stopAt = mine.findIndex((e) => STOP_TAGS.has(e.tag));
      const failAt = mine.findIndex((e) => e.tag === "AgentCompleted");
      if (failAt >= 0) expect(stopAt).toBeLessThan(failAt);
      expect(mine.some((e) => (e.error ?? "").includes("ManagedRuntime"))).toBe(false);
      expect((yield* svc.getActive()).has(String(runId))).toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  }, 15_000);

  it("Stop: a run that does not reach a phase boundary within the grace window still ends as stopped", async () => {
    const { layer, events } = recordingRunner({ stopGraceMs: 300 });
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const { runId } = yield* svc.start(slowRun);
      yield* Effect.sleep("300 millis");
      yield* svc.stop(runId as never);
      const ended = yield* waitFor(() => events.some((e) => e.runId === runId && STOP_TAGS.has(e.tag)), 2_500);
      expect(ended).toBe(true);
      // It did not run on to a successful finish after the user stopped it.
      expect(events.some((e) => e.runId === runId && e.tag === "AgentCompleted" && e.error === undefined)).toBe(false);
      yield* waitFor(() => false, 500);
      expect((yield* svc.getActive()).has(String(runId))).toBe(false);
      expect(events.some((e) => (e.error ?? "").includes("ManagedRuntime"))).toBe(false);
    });
    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  }, 15_000);
});

// The framework publishes DebriefCompleted on the agent's bus (runtime
// `debrief-synthesis.ts`), which the runner forwards to ingest. The runner
// used to also ingest a synthetic copy from `result.debrief`, so every desk
// run with memory on stored two debriefs.
describe("CortexRunnerService — one debrief per desk run", () => {
  it("a run with memory on ingests exactly one DebriefCompleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-runner-debrief-"));
    const db = new Database(":memory:");
    applySchema(db);
    const tags: { runId: string; tag: string }[] = [];
    const ingestLayer = Layer.succeed(CortexIngestService, {
      handleEvent: (_agentId, runId, msg) => Effect.sync(() => void tags.push({ runId, tag: msg.event._tag })),
      getSubscriberCount: () => Effect.succeed(0),
    });
    const layer = CortexRunnerServiceLive.pipe(Layer.provide(Layer.merge(CortexStoreServiceLive(db), ingestLayer)));
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const { runId } = yield* svc.start({
        provider: "test",
        prompt: "What is six times seven?",
        strategy: "reactive",
        maxIterations: 3,
        memory: { working: true, episodic: false, semantic: false },
        rawConfig: { memory: { dbPath: join(dir, "memory.db") } },
        testScenario: [{ text: "The answer is 42." }],
      });
      const debriefs = () => tags.filter((t) => t.runId === runId && t.tag === "DebriefCompleted").length;
      const end = Date.now() + 8_000;
      while (debriefs() === 0 && Date.now() < end) yield* Effect.sleep("50 millis");
      // Leave room for a late second copy (the daemon publish or the result re-emit).
      yield* Effect.sleep("1500 millis");
      expect(debriefs()).toBe(1);
    });
    try {
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  // RunCostFinalized fires after the background debrief call settles, after run()
  // resolved: the runner must keep forwarding until it lands, then tear down.
  it("a run with a debrief ingests its RunCostFinalized (the run's final total) exactly once, after AgentCompleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-runner-cost-"));
    const db = new Database(":memory:");
    applySchema(db);
    const tags: { runId: string; tag: string }[] = [];
    const ingestLayer = Layer.succeed(CortexIngestService, {
      handleEvent: (_agentId, runId, msg) => Effect.sync(() => void tags.push({ runId, tag: msg.event._tag })),
      getSubscriberCount: () => Effect.succeed(0),
    });
    const layer = CortexRunnerServiceLive.pipe(Layer.provide(Layer.merge(CortexStoreServiceLive(db), ingestLayer)));
    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;
      const { runId } = yield* svc.start({
        provider: "test",
        prompt: "What is six times seven?",
        strategy: "reactive",
        maxIterations: 3,
        memory: { working: true, episodic: false, semantic: false },
        rawConfig: { memory: { dbPath: join(dir, "memory.db") } },
        // A non-trivial answer (>= 100 chars) schedules the LLM debrief; it answers slowly,
        // so RunCostFinalized is published well after run() resolves.
        testScenario: [
          { text: "The answer is 42. Six times seven is forty-two, which I computed by adding six to itself seven times over." },
          { text: '{"summary":"Computed 6 x 7 = 42.","keyFindings":[],"errorsEncountered":[],"lessonsLearned":[],"caveats":""}', delayMs: 1_500 },
        ],
      });
      const mine = () => tags.filter((t) => t.runId === runId).map((t) => t.tag);
      const end = Date.now() + 8_000;
      while (!mine().includes("RunCostFinalized") && Date.now() < end) yield* Effect.sleep("50 millis");
      yield* Effect.sleep("500 millis");
      expect(mine().filter((t) => t === "RunCostFinalized").length).toBe(1);
      expect(mine().indexOf("RunCostFinalized")).toBeGreaterThan(mine().indexOf("AgentCompleted"));
    });
    try {
      await Effect.runPromise(program.pipe(Effect.provide(layer)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("buildCortexAgent — agentId passthrough", () => {
  it("uses the supplied agentId when provided", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentId: "cortex-stable-test-id",
    });
    expect(agent.agentId).toBe("cortex-stable-test-id");
  });

  it("generates a name-timestamp agentId when no agentId is provided", async () => {
    const agent = await buildCortexAgent({
      provider: "test",
      agentName: "mybot",
    });
    expect(agent.agentId).toMatch(/^mybot-\d+$/);
  });
});
