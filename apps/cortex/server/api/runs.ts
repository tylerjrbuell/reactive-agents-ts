import { Elysia, t } from "elysia";
import { Effect, Layer, Option } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { CortexRunnerService } from "../services/runner-service.js";
import type { RunId } from "../types.js";

export const runsRouter = (
  storeLayer: Layer.Layer<CortexStoreService>,
  runnerLayer: Layer.Layer<CortexRunnerService>,
) =>
  new Elysia({ prefix: "/api/runs" })
    .post(
      "/",
      async ({ body, set }) => {
        const program = Effect.gen(function* () {
          const runner = yield* CortexRunnerService;
          return yield* runner.start({
            prompt: body.prompt,
            ...(body.provider ? { provider: body.provider } : {}),
            ...(body.model ? { model: body.model } : {}),
            ...(body.tools ? { tools: body.tools } : {}),
          });
        });
        try {
          return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
        } catch (e) {
          set.status = 500;
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
      {
        body: t.Object({
          prompt: t.String(),
          provider: t.Optional(t.String()),
          model: t.Optional(t.String()),
          tools: t.Optional(t.Array(t.String())),
        }),
      },
    )
    .post("/:runId/pause", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        yield* runner.pause(params.runId as RunId);
        return { ok: true as const };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .post("/:runId/stop", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        yield* runner.stop(params.runId as RunId);
        return { ok: true as const };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .delete("/:runId", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        const deleted = yield* store.deleteRun(params.runId);
        if (!deleted) {
          set.status = 404;
          return { error: "Run not found" };
        }
        return { ok: true as const, deleted: 1 as const };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .post(
      "/prune",
      async ({ body, set }) => {
        const program = Effect.gen(function* () {
          const store = yield* CortexStoreService;
          const hours = body.olderThanHours ?? 24 * 7;
          const olderThanMs = Math.max(1, hours) * 60 * 60 * 1000;
          const deleted = yield* store.pruneRuns(olderThanMs, body.includeLive ?? false);
          return { ok: true as const, deleted };
        });
        try {
          return await Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      {
        body: t.Object({
          olderThanHours: t.Optional(t.Number()),
          includeLive: t.Optional(t.Boolean()),
        }),
      },
    )
    .post("/:runId/recompute-stats", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        const ok = yield* store.recomputeRunStats(params.runId);
        if (!ok) {
          set.status = 404;
          return { error: "Run not found or has no events" };
        }
        return { ok: true as const };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getRecentRuns(50);
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    })
    .get("/:runId/events", async ({ params }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getRunEvents(params.runId);
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    })
    .get("/:runId", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        // Use getRunDetail which includes raw debrief JSON for the UI
        const run = yield* store.getRunDetail(params.runId);
        if (Option.isNone(run)) {
          set.status = 404;
          return { error: "Run not found" };
        }
        return run.value;
      });
      return Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
    });
