import { Elysia, t } from "elysia";
import { Effect, Layer, Option } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { CortexError } from "../errors.js";
import type { VariableDef } from "../services/resolve-template.js";
import type { RunId } from "../types.js";

/**
 * Body schema for `POST /api/runs`. Exported so the chat ⇄ runs config-parity
 * drift-guard test can assert the chat session body covers the same agent-config
 * fields (see wiki/Research/Audit-Reports-2026-06-09/cortex-agent-quality-parity-audit.md).
 */
export const RunConfigBody = t.Object({
  prompt: t.String(),
  provider:           t.Optional(t.String()),
  model:              t.Optional(t.String()),
  tools:              t.Optional(t.Array(t.String())),
  additionalToolNames: t.Optional(t.String()),
  strategy:           t.Optional(t.String()),
  temperature:        t.Optional(t.Number()),
  maxIterations:      t.Optional(t.Number()),
  minIterations:      t.Optional(t.Number()),
  systemPrompt:       t.Optional(t.String()),
  agentName:          t.Optional(t.String()),
  maxTokens:          t.Optional(t.Number()),
  numCtx:             t.Optional(t.Number()),
  timeout:            t.Optional(t.Number()),
  retryPolicy:        t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), maxRetries: t.Number(), backoffMs: t.Optional(t.Number()) })),
  cacheTimeout:       t.Optional(t.Number()),
  progressCheckpoint: t.Optional(t.Number()),
  fallbacks:          t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), providers: t.Optional(t.Array(t.String())), errorThreshold: t.Optional(t.Number()) })),
  metaTools:          t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), brief: t.Optional(t.Boolean()), find: t.Optional(t.Boolean()), pulse: t.Optional(t.Boolean()), recall: t.Optional(t.Boolean()), harnessSkill: t.Optional(t.Boolean()) })),
  verificationStep:   t.Optional(t.String()),
  runtimeVerification: t.Optional(t.Boolean()),
  terminalTools: t.Optional(t.Boolean()),
  terminalShellAdditionalCommands: t.Optional(t.String()),
  terminalShellAllowedCommands: t.Optional(t.String()),
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
  auditRationale: t.Optional(t.Boolean()),
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
  variables: t.Optional(t.Array(t.Unknown())),
  variableValues: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
  useReasoning: t.Optional(t.Boolean()),
  outputSchema: t.Optional(t.Record(t.String(), t.Unknown())),
  outputSchemaOnParseFail: t.Optional(t.Union([t.Literal("degrade"), t.Literal("throw")])),
  budget: t.Optional(t.Object({ tokenLimit: t.Optional(t.Number()), costLimit: t.Optional(t.Number()) })),
  grounding: t.Optional(t.Object({ mode: t.Union([t.Literal("warn"), t.Literal("block")]), tolerance: t.Optional(t.Number()) })),
  modelRouting: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      minTier: t.Optional(t.Union([t.Literal("haiku"), t.Literal("sonnet"), t.Literal("opus")])),
      tierModels: t.Optional(t.Record(t.String(), t.String())),
    }),
  ),
  // Generic type-introspected config overrides (nested partial AgentConfig).
  rawConfig: t.Optional(t.Record(t.String(), t.Unknown())),
  durableRuns: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      checkpointEvery: t.Optional(t.Number()),
      dir: t.Optional(t.String()),
      approvalPolicy: t.Optional(
        t.Object({
          tools: t.Optional(t.Array(t.String())),
          mode: t.Optional(t.Union([t.Literal("detach"), t.Literal("block")])),
        }),
      ),
    }),
  ),
});

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
            ...(typeof b.additionalToolNames === "string" && b.additionalToolNames.trim() !== ""
              ? { additionalToolNames: b.additionalToolNames.trim() }
              : {}),
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
            ...(b.numCtx           ? { numCtx:           b.numCtx }           : {}),
            ...(b.timeout          ? { timeout:          b.timeout }          : {}),
            ...(b.retryPolicy      ? { retryPolicy:      b.retryPolicy }      : {}),
            ...(b.cacheTimeout     ? { cacheTimeout:     b.cacheTimeout }     : {}),
            ...(b.progressCheckpoint ? { progressCheckpoint: b.progressCheckpoint } : {}),
            ...(b.fallbacks        ? { fallbacks:        b.fallbacks }        : {}),
            ...(b.metaTools        ? { metaTools:        b.metaTools }        : {}),
            ...(b.verificationStep ? { verificationStep: b.verificationStep } : {}),
            ...(b.runtimeVerification === true ? { runtimeVerification: true as const } : {}),
            ...(b.terminalTools === true ? { terminalTools: true as const } : {}),
            ...(typeof b.terminalShellAdditionalCommands === "string" &&
            b.terminalShellAdditionalCommands.trim() !== ""
              ? { terminalShellAdditionalCommands: b.terminalShellAdditionalCommands.trim() }
              : {}),
            ...(typeof b.terminalShellAllowedCommands === "string" &&
            b.terminalShellAllowedCommands.trim() !== ""
              ? { terminalShellAllowedCommands: b.terminalShellAllowedCommands.trim() }
              : {}),
            ...(b.observabilityVerbosity ? { observabilityVerbosity: b.observabilityVerbosity } : {}),
            ...(b.taskContext && typeof b.taskContext === "object" && !Array.isArray(b.taskContext) && Object.keys(b.taskContext).length > 0
              ? { taskContext: b.taskContext as Record<string, string> }
              : {}),
            ...(b.healthCheck === true ? { healthCheck: true as const } : {}),
            ...(b.skills?.paths?.length ? { skills: b.skills } : {}),
            ...(Array.isArray(b.variables) && b.variables.length ? { variables: b.variables as VariableDef[] } : {}),
            ...(b.variableValues && typeof b.variableValues === "object" && !Array.isArray(b.variableValues)
              ? { variableValues: b.variableValues as Record<string, string | number> }
              : {}),
            ...(b.strategySwitching != null ? { strategySwitching: b.strategySwitching } : {}),
            ...(b.auditRationale === true ? { auditRationale: true as const } : {}),
            ...(b.memory ? { memory: b.memory } : {}),
            ...(b.contextSynthesis ? { contextSynthesis: b.contextSynthesis } : {}),
            ...(b.guardrails ? { guardrails: b.guardrails } : {}),
            ...(b.persona ? { persona: b.persona } : {}),
            ...(typeof b.useReasoning === "boolean" ? { useReasoning: b.useReasoning } : {}),
            ...(b.outputSchema && Object.keys(b.outputSchema).length > 0 ? { outputSchema: b.outputSchema } : {}),
            ...(b.outputSchemaOnParseFail ? { outputSchemaOnParseFail: b.outputSchemaOnParseFail } : {}),
            ...(b.budget && ((b.budget.tokenLimit ?? 0) > 0 || (b.budget.costLimit ?? 0) > 0) ? { budget: b.budget } : {}),
            ...(b.grounding?.mode ? { grounding: b.grounding } : {}),
            ...(b.modelRouting?.enabled ? { modelRouting: b.modelRouting } : {}),
            ...(b.rawConfig && typeof b.rawConfig === "object" && Object.keys(b.rawConfig).length > 0 ? { rawConfig: b.rawConfig } : {}),
            ...(b.durableRuns?.enabled ? { durableRuns: b.durableRuns } : {}),
          });
        });
        try {
          return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = msg.includes("Unresolved template variable") ? 400 : 500;
          return { error: msg };
        }
      },
      {
        body: RunConfigBody,
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
    .post("/:runId/resume", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        yield* runner.resume(params.runId as RunId);
        return { ok: true as const };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .post("/:runId/terminate", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        yield* runner.terminate(params.runId as RunId);
        return { ok: true as const };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    // Repeat a finished/failed run with its exact stored config (D1 snapshot).
    .post("/:runId/rerun", async ({ params, set }) => {
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        const runner = yield* CortexRunnerService;
        const snapshot = yield* store.getLaunchParams(params.runId);
        if (!snapshot || typeof snapshot.prompt !== "string") {
          return yield* Effect.fail(new CortexError({ message: "No stored config to rerun" }));
        }
        return yield* runner.start(snapshot as unknown as LaunchParams);
      });
      try {
        return await Effect.runPromise(
          program.pipe(Effect.provide(Layer.merge(storeLayer, runnerLayer))),
        );
      } catch (e) {
        set.status = 400;
        return { ok: false, error: String(e) };
      }
    })
    // ── Durable HITL (Phase E) ──
    // Pending durable approvals across all runs paused in this process.
    .get("/pending-approvals", async ({ set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        return { approvals: yield* runner.listPendingApprovals() };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .post(
      "/:runId/approve",
      async ({ params, body, set }) => {
        const program = Effect.gen(function* () {
          const runner = yield* CortexRunnerService;
          yield* runner.approveApproval(params.runId as RunId, body?.reason);
          return { ok: true as const };
        });
        try {
          return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
    )
    .post(
      "/:runId/deny",
      async ({ params, body, set }) => {
        const program = Effect.gen(function* () {
          const runner = yield* CortexRunnerService;
          yield* runner.denyApproval(params.runId as RunId, body?.reason ?? "Denied from Cortex");
          return { ok: true as const };
        });
        try {
          return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
    )
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
    .patch(
      "/:runId/label",
      async ({ params, body, set }) => {
        if (!body.label.trim()) {
          set.status = 400;
          return { error: "label must be a non-empty string" };
        }
        const program = Effect.gen(function* () {
          const store = yield* CortexStoreService;
          const found = yield* store.updateRunLabel(params.runId, body.label);
          return found;
        });
        try {
          const result = await Effect.runPromise(program.pipe(Effect.provide(storeLayer)));
          if (!result.ok) {
            set.status = 404;
            return { error: "Run not found" };
          }
          return { ok: true };
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      {
        body: t.Object({
          label: t.String(),
        }),
      },
    )
    .get("/", async ({ query }) => {
      const limit = query.limit != null ? Math.max(0, Number(query.limit)) : 50;
      const program = Effect.gen(function* () {
        const store = yield* CortexStoreService;
        return yield* store.getRecentRuns(limit);
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
