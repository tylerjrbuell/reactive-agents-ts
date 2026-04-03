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
