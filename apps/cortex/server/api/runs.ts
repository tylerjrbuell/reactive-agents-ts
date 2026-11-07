import { Elysia, t, type Static } from "elysia";
import { Effect, Layer, Option } from "effect";
import { CortexStoreService } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { CortexError } from "../errors.js";
import {
  parseAgentToolEntries,
  parseCortexShellOptions,
  parseDocumentSpecs,
} from "../services/cortex-agent-config.js";
import { parseVariableDefs } from "../services/resolve-template.js";
import type { RunId } from "../types.js";
import { readRunTraceFile } from "../services/run-trace-file.js";
import { checkWorkspaceDir } from "../services/workspace-dir.js";
import { AgentConfigBodyFields } from "./agent-config-body.js";

/**
 * Body schema for `POST /api/runs`: the run-launch inputs plus the shared
 * {@link AgentConfigBodyFields} that `ChatSessionConfigBody` also spreads, so a
 * desk run and a chat session accept the same agent config (pinned by
 * `chat-runs-config-drift.test.ts`).
 */
export const RunConfigBody = t.Object({
  prompt: t.String(),
  agentName: t.Optional(t.String()),
  variables: t.Optional(t.Array(t.Unknown())),
  variableValues: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
  ...AgentConfigBodyFields,
});

type ModelTier = "haiku" | "sonnet" | "opus";
const MODEL_TIERS: readonly ModelTier[] = ["haiku", "sonnet", "opus"];

/** Keeps only the known tier keys of a `modelRouting.tierModels` record. */
function pickTierModels(
  raw: Readonly<Record<string, string>> | undefined,
): Partial<Record<ModelTier, string>> | undefined {
  if (!raw) return undefined;
  const out: Partial<Record<ModelTier, string>> = {};
  for (const tier of MODEL_TIERS) {
    const model = raw[tier];
    if (typeof model === "string" && model.trim() !== "") out[tier] = model;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const runsRouter = (
  storeLayer: Layer.Layer<CortexStoreService>,
  runnerLayer: Layer.Layer<CortexRunnerService>,
) =>
  new Elysia({ prefix: "/api/runs" })
    .post(
      "/",
      async ({ body, set }) => {
        const b: Static<typeof RunConfigBody> = body;
        const parsedDocuments = parseDocumentSpecs(b.documents);
        const ws = typeof b.workspace === "string" && b.workspace.trim() !== "" ? checkWorkspaceDir(b.workspace) : undefined;
        if (ws && !ws.ok) {
          set.status = 400;
          return { error: ws.error };
        }
        const shellOptions = parseCortexShellOptions(b.terminalShellOptions);
        const agentTools = parseAgentToolEntries(b.agentTools);
        const variables = parseVariableDefs(b.variables);
        const tierModels = pickTierModels(b.modelRouting?.tierModels);
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
            ...(agentTools ? { agentTools } : {}),
            ...(b.dynamicSubAgents ? { dynamicSubAgents: b.dynamicSubAgents } : {}),
            ...(b.strategy         ? { strategy:         b.strategy }         : {}),
            ...(b.temperature != null ? { temperature:   b.temperature }      : {}),
            ...(b.maxIterations    ? { maxIterations:    b.maxIterations }    : {}),
            ...(b.minIterations    ? { minIterations:    b.minIterations }    : {}),
            ...(b.systemPrompt     ? { systemPrompt:     b.systemPrompt }     : {}),
            ...(b.agentName        ? { agentName:        b.agentName }        : {}),
            ...(b.maxTokens        ? { maxTokens:        b.maxTokens }        : {}),
            ...(b.numCtx           ? { numCtx:           b.numCtx }           : {}),
            ...(typeof b.thinking === "boolean" ? { thinking: b.thinking } : {}),
            ...(b.timeout          ? { timeout:          b.timeout }          : {}),
            ...(b.retryPolicy      ? { retryPolicy:      b.retryPolicy }      : {}),
            ...(b.fallbacks        ? { fallbacks:        b.fallbacks }        : {}),
            ...(b.metaTools        ? { metaTools:        b.metaTools }        : {}),
            ...(b.observability    ? { observability:    b.observability }    : {}),
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
            ...(b.taskContext && Object.keys(b.taskContext).length > 0 ? { taskContext: b.taskContext } : {}),
            ...(b.healthCheck === true ? { healthCheck: true as const } : {}),
            ...(b.skills?.paths?.length ? { skills: b.skills } : {}),
            ...(variables ? { variables } : {}),
            ...(b.variableValues ? { variableValues: b.variableValues } : {}),
            ...(b.strategySwitching != null ? { strategySwitching: b.strategySwitching } : {}),
            ...(b.auditRationale === true ? { auditRationale: true as const } : {}),
            ...(b.memory ? { memory: b.memory } : {}),
            ...(b.contextSynthesis ? { contextSynthesis: b.contextSynthesis } : {}),
            ...(b.guardrails ? { guardrails: b.guardrails } : {}),
            ...(b.persona ? { persona: b.persona } : {}),
            ...(b.outputSchema && Object.keys(b.outputSchema).length > 0 ? { outputSchema: b.outputSchema } : {}),
            ...(b.harness && Object.keys(b.harness).length > 0 ? { harness: b.harness } : {}),
            ...(parsedDocuments ? { documents: parsedDocuments } : {}),
            ...(b.outputSchemaOnParseFail ? { outputSchemaOnParseFail: b.outputSchemaOnParseFail } : {}),
            ...(b.budget && ((b.budget.tokenLimit ?? 0) > 0 || (b.budget.costLimit ?? 0) > 0) ? { budget: b.budget } : {}),
            ...(b.grounding?.mode ? { grounding: b.grounding } : {}),
            ...(b.fabricationGuard ? { fabricationGuard: b.fabricationGuard } : {}),
            ...(b.modelRouting?.enabled
              ? {
                  modelRouting: {
                    enabled: true,
                    ...(b.modelRouting.minTier ? { minTier: b.modelRouting.minTier } : {}),
                    ...(tierModels ? { tierModels } : {}),
                  },
                }
              : {}),
            ...(b.rawConfig && typeof b.rawConfig === "object" && Object.keys(b.rawConfig).length > 0 ? { rawConfig: b.rawConfig } : {}),
            ...(b.durableRuns?.enabled ? { durableRuns: b.durableRuns } : {}),
            ...(ws?.ok ? { workspace: ws.path } : {}),
            ...(shellOptions ? { terminalShellOptions: shellOptions } : {}),
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
    // ── Durable interaction rail (Agentic-UI) — request_user_input pauses,
    // clone of the approval routes above. ──
    .get("/pending-interactions", async ({ set }) => {
      const program = Effect.gen(function* () {
        const runner = yield* CortexRunnerService;
        return { interactions: yield* runner.listPendingInteractions() };
      });
      try {
        return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
      } catch (e) {
        set.status = 500;
        return { error: String(e) };
      }
    })
    .post(
      "/:runId/interaction",
      async ({ params, body, set }) => {
        const program = Effect.gen(function* () {
          const runner = yield* CortexRunnerService;
          return yield* runner.respondToInteraction(
            params.runId as RunId,
            body.interactionId,
            body.value,
          );
        });
        try {
          return await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      { body: t.Object({ interactionId: t.String(), value: t.Unknown() }) },
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
    // Raw troubleshooting trace. Serves the framework tracer's JSONL verbatim; when the run has
    // no trace file, falls back to the persisted event log (one JSON object per line) and says so
    // in `x-trace-source` so the download is never silently a different artifact.
    .get("/:runId/trace", async ({ params, set }) => {
      const raw = readRunTraceFile(params.runId);
      const headers = {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="${params.runId}.jsonl"`,
      };
      if (raw !== undefined) return new Response(raw, { headers: { ...headers, "x-trace-source": "tracer" } });
      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* CortexStoreService;
          return yield* store.getRunEvents(params.runId);
        }).pipe(Effect.provide(storeLayer)),
      );
      if (events.length === 0) {
        set.status = 404;
        return { error: "No trace or events recorded for this run" };
      }
      return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
        headers: { ...headers, "x-trace-source": "cortex-events" },
      });
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
