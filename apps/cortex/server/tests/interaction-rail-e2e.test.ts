// Run: bun test apps/cortex/server/tests/interaction-rail-e2e.test.ts --timeout 30000
//
// Task X1 added `request_user_input` support to the Cortex server:
// `CortexRunnerService.listPendingInteractions`/`respondToInteraction` + a
// registration branch in the runner's durable-pause callback (registers
// `awaiting-interaction` pauses into the shared `durable-approvals` registry)
// + `.withUserInteraction()` in `build-cortex-agent.ts`. The X1 route tests
// (api-interactions.test.ts) exercise this ONLY against a mocked
// `CortexRunnerService` — the real path (build a durable agent via the real
// runner service → it pauses on `request_user_input` → the pause callback
// registers it → `listPendingInteractions` finds it →
// `respondToInteraction` resumes it to completion) was unverified at the
// Cortex layer. This test drives the REAL `CortexRunnerServiceLive`, with a
// real agent built through the actual Cortex build path
// (`buildCortexAgent` via `CortexRunnerService.start`), on the deterministic
// `test` provider — no mocks of the runner or the agent.
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Context, Effect, Layer, Schedule } from "effect";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexIngestService } from "../services/ingest-service.js";
import { CortexRunnerService, CortexRunnerServiceLive } from "../services/runner-service.js";

type RunnerServiceShape = Context.Tag.Service<typeof CortexRunnerService>;

/** Poll `listPendingInteractions()` until it sees at least one entry or a 10s
 * timeout elapses. The agent's `.run()` inside `start()` is fire-and-forget
 * (`void agent.run(...).then(...)`), so the pause-registration into the
 * shared `durable-approvals` registry happens asynchronously after `start()`
 * resolves — this is a genuine async boundary, not a fixed sleep. */
const waitForPendingInteraction = (svc: RunnerServiceShape) =>
  svc.listPendingInteractions().pipe(
    Effect.flatMap((l) => (l.length > 0 ? Effect.succeed(l) : Effect.fail("not-yet" as const))),
    Effect.retry(Schedule.spaced("25 millis")),
    Effect.timeoutFail({
      duration: "10 seconds",
      onTimeout: () => new Error("timed out waiting for pending interaction to register"),
    }),
  );

const durableDir = () => mkdtempSync(join(tmpdir(), "cortex-interaction-e2e-"));

/** Real runner layer: real store + a no-op ingest stub (event forwarding is
 * not under test here — only the pause/register/respond round trip is). */
const buildRunnerLayer = () => {
  const db = new Database(":memory:");
  applySchema(db);
  const storeLayer = CortexStoreServiceLive(db);
  const ingestLayer = Layer.succeed(CortexIngestService, {
    handleEvent: () => Effect.void,
    getSubscriberCount: () => Effect.succeed(0),
  });
  return CortexRunnerServiceLive.pipe(Layer.provide(Layer.merge(storeLayer, ingestLayer)));
};

describe("interaction rail e2e — real CortexRunnerServiceLive, real agent, no mocks", () => {
  it("pause → register → listPendingInteractions → respondToInteraction → resume → complete", async () => {
    const dir = durableDir();

    const program = Effect.gen(function* () {
      const svc = yield* CortexRunnerService;

      // 1. Start a durable Cortex agent through the REAL runner service. The
      // scripted test-provider scenario calls request_user_input (kind
      // "choice") on turn 1; turn 2 only matches when the resumed prompt
      // contains "blue" (the deterministic proof the human's answer reached
      // the model).
      const { runId } = yield* svc.start({
        provider: "test",
        prompt: "help me choose",
        durableRuns: { enabled: true, dir },
        testScenario: [
          {
            toolCall: {
              name: "request_user_input",
              args: { kind: "choice", prompt: "Which option?", schema: { options: ["red", "blue"] } },
            },
          },
          { match: "blue", text: "You picked blue. FINAL." },
          { text: "fallback" },
        ],
      });

      // Give agent.run() (fire-and-forget inside start()) a moment to reach
      // the pause and register into the shared durable-approvals registry.
      yield* waitForPendingInteraction(svc);

      // 2. The run PAUSED — it must not be in the active registry, and
      // listPendingInteractions() must see exactly the one pending interaction.
      const pending = yield* svc.listPendingInteractions();
      expect(pending.length).toBe(1);
      expect(pending[0]!.kind).toBe("choice");
      expect(pending[0]!.prompt).toBe("Which option?");
      const interactionRunId = pending[0]!.runId;
      const interactionId = pending[0]!.interactionId;

      // 3. Respond — this must resume the SAME agent instance to completion.
      const result = yield* svc.respondToInteraction(interactionRunId as never, interactionId, "blue");
      expect(result.success).toBe(true);
      expect(result.output).toContain("blue");

      // 4. Fully drained — no pending interactions remain.
      const after = yield* svc.listPendingInteractions();
      expect(after.length).toBe(0);

      // Bonus: the original cortex runId must have left the active registry
      // too (paused runs are dropped from `activeRef` per runner-service.ts).
      const active = yield* svc.getActive();
      expect(active.has(String(runId))).toBe(false);
    });

    await Effect.runPromise(program.pipe(Effect.provide(buildRunnerLayer())));
  }, 30000);
});
