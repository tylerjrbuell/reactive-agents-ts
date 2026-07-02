import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexRunnerService, CortexRunnerServiceLive } from "../services/runner-service.js";
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
