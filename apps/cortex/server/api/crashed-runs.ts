import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { Effect, type Layer } from "effect";
import { CortexRunnerService } from "../services/runner-service.js";
import { crashedRunSummaryOf, findCrashedRuns } from "../services/crashed-runs.js";
import { closeContinuedRunRow } from "../services/loop-stopped-runs.js";

/**
 * Crashed durable desk runs (roadmap C13, `services/crashed-runs.ts`).
 *
 * - `GET /api/crashed-runs`: desk runs left `live` by a crash whose durable
 *   store holds a checkpoint (`{ runs: CrashedRunSummary[] }`).
 * - `POST /api/crashed-runs/:runId/resume`: rebuild the run's agent and call
 *   the framework's `resumeRun` as a new linked run; `{ agentId, runId }` (the NEW run's id).
 *   404 when the run is not a resumable crashed run (finished, running, not
 *   durable, or no checkpoint).
 */
export const crashedRunsRouter = (
  db: Database,
  runnerLayer: Layer.Layer<CortexRunnerService>,
  home?: string,
) => {
  const activeRunIds = Effect.gen(function* () {
    const runner = yield* CortexRunnerService;
    return new Set((yield* runner.getActive()).keys());
  });
  return new Elysia({ prefix: "/api/crashed-runs" })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const active = yield* activeRunIds;
        const runs = yield* findCrashedRuns(db, { activeRunIds: active, ...(home ? { home } : {}) });
        return { runs: runs.map(crashedRunSummaryOf) };
      });
      return Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
    })
    .post("/:runId/resume", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        const active = yield* activeRunIds;
        const [crashed] = yield* findCrashedRuns(db, {
          activeRunIds: active,
          runId: params.runId,
          ...(home ? { home } : {}),
        });
        if (!crashed) return null;
        const started = yield* runner.resumeCrashed(crashed);
        // The continuation is its own run now: the crashed parent's `live` row is closed.
        closeContinuedRunRow(db, params.runId);
        return started;
      });
      try {
        const out = await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
        if (!out) {
          set.status = 404;
          return { error: "Not a crashed durable run with a checkpoint" };
        }
        return out;
      } catch (e) {
        set.status = 500;
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
};
