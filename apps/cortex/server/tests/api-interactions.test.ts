// Run: bun test apps/cortex/server/tests/api-interactions.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";

const mockRunnerLayer = Layer.succeed(CortexRunnerService, {
  start: () =>
    Effect.succeed({ agentId: "test-runner-agent", runId: "01HZTEST000000000000000000" }),
  pause: () => Effect.void,
  resume: () => Effect.void,
  stop: () => Effect.void,
  terminate: () => Effect.void,
  getActive: () => Effect.succeed(new Map()),
  listPendingApprovals: () => Effect.succeed([]),
  approveApproval: () => Effect.void,
  denyApproval: () => Effect.void,
  listPendingInteractions: () =>
    Effect.succeed([
      {
        runId: "r1",
        interactionId: "i1",
        kind: "choice",
        prompt: "Pick",
        schema: { options: ["a", "b"] },
        task: "t",
        updatedAt: 1,
      },
    ]),
  respondToInteraction: () => Effect.succeed({ success: true, output: "done" }),
});

function appWithRunsDb(db: Database) {
  applySchema(db);
  return new Elysia().use(runsRouter(CortexStoreServiceLive(db), mockRunnerLayer));
}

describe("interaction routes", () => {
  it("GET /api/runs/pending-interactions returns pending interactions", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);

    const res = await app.handle(
      new Request("http://localhost/api/runs/pending-interactions"),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { interactions: unknown[] };
    expect(json.interactions.length).toBe(1);
  });

  it("POST /api/runs/:runId/interaction returns success", async () => {
    const db = new Database(":memory:");
    const app = appWithRunsDb(db);

    const res = await app.handle(
      new Request("http://localhost/api/runs/r1/interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: "i1", value: "a" }),
      }),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; output: string };
    expect(json.success).toBe(true);
    expect(json.output).toBe("done");
  });
});
