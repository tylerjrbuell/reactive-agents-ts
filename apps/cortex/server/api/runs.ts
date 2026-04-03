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
        const b = body as any;
        const program = Effect.gen(function* () {
          const runner = yield* CortexRunnerService;
          return yield* runner.start({
            prompt: b.prompt,
            ...(b.provider         ? { provider:         b.provider }         : {}),
            ...(b.model            ? { model:            b.model }            : {}),
            ...(b.tools            ? { tools:            b.tools }            : {}),
            ...(b.mcpServerIds?.length ? { mcpServerIds: b.mcpServerIds } : {}),
            ...(b.agentTools?.length ? { agentTools: b.agentTools } : {}),
            ...(b.dynamicSubAgents ? { dynamicSubAgents: b.dynamicSubAgents } : {}),
            ...(b.strategy         ? { strategy:         b.strategy }         : {}),
            ...(b.temperature != null ? { temperature:   b.temperature }      : {}),
            ...(b.maxIterations    ? { maxIterations:    b.maxIterations }    : {}),
            ...(b.minIterations    ? { minIterations:    b.minIterations }    : {}),
            ...(b.systemPrompt     ? { systemPrompt:     b.systemPrompt }     : {}),
            ...(b.agentName        ? { agentName:        b.agentName }        : {}),
            ...(b.maxTokens        ? { maxTokens:        b.maxTokens }        : {}),
            ...(b.timeout          ? { timeout:          b.timeout }          : {}),
            ...(b.retryPolicy      ? { retryPolicy:      b.retryPolicy }      : {}),
            ...(b.cacheTimeout     ? { cacheTimeout:     b.cacheTimeout }     : {}),
            ...(b.progressCheckpoint ? { progressCheckpoint: b.progressCheckpoint } : {}),
            ...(b.fallbacks        ? { fallbacks:        b.fallbacks }        : {}),
            ...(b.metaTools        ? { metaTools:        b.metaTools }        : {}),
            ...(b.verificationStep ? { verificationStep: b.verificationStep } : {}),
            ...(b.observabilityVerbosity ? { observabilityVerbosity: b.observabilityVerbosity } : {}),
            ...(b.taskContext && typeof b.taskContext === "object" && !Array.isArray(b.taskContext) && Object.keys(b.taskContext).length > 0
              ? { taskContext: b.taskContext as Record<string, string> }
              : {}),
            ...(b.healthCheck === true ? { healthCheck: true as const } : {}),
            ...(b.skills?.paths?.length ? { skills: b.skills } : {}),
            ...(b.strategySwitching != null ? { strategySwitching: b.strategySwitching } : {}),
            ...(b.memory ? { memory: b.memory } : {}),
            ...(b.contextSynthesis ? { contextSynthesis: b.contextSynthesis } : {}),
            ...(b.guardrails ? { guardrails: b.guardrails } : {}),
            ...(b.persona ? { persona: b.persona } : {}),
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
          provider:           t.Optional(t.String()),
          model:              t.Optional(t.String()),
          tools:              t.Optional(t.Array(t.String())),
          strategy:           t.Optional(t.String()),
          temperature:        t.Optional(t.Number()),
          maxIterations:      t.Optional(t.Number()),
          minIterations:      t.Optional(t.Number()),
          systemPrompt:       t.Optional(t.String()),
          agentName:          t.Optional(t.String()),
          maxTokens:          t.Optional(t.Number()),
          timeout:            t.Optional(t.Number()),
          retryPolicy:        t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), maxRetries: t.Number(), backoffMs: t.Optional(t.Number()) })),
          cacheTimeout:       t.Optional(t.Number()),
          progressCheckpoint: t.Optional(t.Number()),
          fallbacks:          t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), providers: t.Optional(t.Array(t.String())), errorThreshold: t.Optional(t.Number()) })),
          metaTools:          t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), brief: t.Optional(t.Boolean()), find: t.Optional(t.Boolean()), pulse: t.Optional(t.Boolean()), recall: t.Optional(t.Boolean()), harnessSkill: t.Optional(t.Boolean()) })),
          verificationStep:   t.Optional(t.String()),
          observabilityVerbosity: t.Optional(t.Union([t.Literal("off"), t.Literal("minimal"), t.Literal("normal"), t.Literal("verbose")])),
          mcpServerIds: t.Optional(t.Array(t.String())),
          agentTools: t.Optional(t.Array(t.Unknown())),
          dynamicSubAgents: t.Optional(
            t.Object({
              enabled: t.Boolean(),
              maxIterations: t.Optional(t.Number()),
            }),
          ),
          taskContext: t.Optional(t.Record(t.String(), t.String())),
          healthCheck: t.Optional(t.Boolean()),
          strategySwitching: t.Optional(t.Boolean()),
          memory: t.Optional(t.Object({ working: t.Optional(t.Boolean()), episodic: t.Optional(t.Boolean()), semantic: t.Optional(t.Boolean()) })),
          contextSynthesis: t.Optional(t.Union([t.Literal("auto"), t.Literal("template"), t.Literal("llm"), t.Literal("none")])),
          guardrails: t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), injectionThreshold: t.Optional(t.Number()), piiThreshold: t.Optional(t.Number()), toxicityThreshold: t.Optional(t.Number()) })),
          persona: t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), role: t.Optional(t.String()), tone: t.Optional(t.String()), traits: t.Optional(t.String()), responseStyle: t.Optional(t.String()) })),
          skills: t.Optional(
            t.Object({
              paths: t.Array(t.String()),
              evolution: t.Optional(
                t.Object({
                  mode: t.Optional(t.String()),
                  refinementThreshold: t.Optional(t.Number()),
                  rollbackOnRegression: t.Optional(t.Boolean()),
                }),
              ),
            }),
          ),
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
