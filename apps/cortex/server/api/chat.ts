import { Elysia, t } from "elysia";
import { ChatSessionBusyError, type ChatSessionService } from "../services/chat-session-service.js";
import type { AgentStreamEvent } from "@reactive-agents/runtime";
import { readRunTreeTraces } from "../services/run-trace-file.js";
import type { ChatScheduleService } from "../services/chat-schedule-service.js";
import type { ChatGoalService, GoalFailure } from "../services/chat-goal-service.js";
import { renderChatMarkdown, slugifyFilename } from "../services/chat-export.js";

export const ChatSessionConfigBody = t.Object({
  name: t.Optional(t.String()),
  provider: t.Optional(t.String()),
  model: t.Optional(t.String()),
  systemPrompt: t.Optional(t.String()),
  temperature: t.Optional(t.Number()),
  maxTokens: t.Optional(t.Number()),
  tools: t.Optional(t.Array(t.String())),
  runId: t.Optional(t.String()),
  enableTools: t.Optional(t.Boolean()),
  streamReasoningSteps: t.Optional(t.Boolean()),
  /** Auto-name the chat from its first exchange (default on). */
  autoName: t.Optional(t.Boolean()),
  /** Persist a framework JSONL run trace per chat turn (default on). */
  traceRuns: t.Optional(t.Boolean()),
  maxIterations: t.Optional(t.Number()),
  strategy: t.Optional(t.String()),
  strategySwitching: t.Optional(t.Boolean()),
  runtimeVerification: t.Optional(t.Boolean()),
  auditRationale: t.Optional(t.Boolean()),
  verificationStep: t.Optional(t.Union([t.Literal("none"), t.Literal("reflect")])),
  budget: t.Optional(t.Object({ tokenLimit: t.Optional(t.Number()), costLimit: t.Optional(t.Number()) })),
  grounding: t.Optional(t.Object({ mode: t.Union([t.Literal("warn"), t.Literal("block")]), tolerance: t.Optional(t.Number()) })),
  fabricationGuard: t.Optional(t.Union([t.Literal("off"), t.Literal("warn"), t.Literal("block")])),
  modelRouting: t.Optional(t.Object({ enabled: t.Optional(t.Boolean()), minTier: t.Optional(t.Union([t.Literal("haiku"), t.Literal("sonnet"), t.Literal("opus")])), tierModels: t.Optional(t.Record(t.String(), t.String())) })),
  outputSchema: t.Optional(t.Record(t.String(), t.Unknown())),
  harness: t.Optional(t.Record(t.String(), t.Unknown())),
  documents: t.Optional(t.Array(t.Object({ source: t.Optional(t.String()), content: t.Optional(t.String()), format: t.Optional(t.String()), chunkStrategy: t.Optional(t.String()), maxChunkSize: t.Optional(t.Number()) }))),
  contextSynthesis: t.Optional(
    t.Union([t.Literal("auto"), t.Literal("template"), t.Literal("llm"), t.Literal("none")]),
  ),
  guardrails: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      injectionThreshold: t.Optional(t.Number()),
      piiThreshold: t.Optional(t.Number()),
      toxicityThreshold: t.Optional(t.Number()),
    }),
  ),
  persona: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      role: t.Optional(t.String()),
      tone: t.Optional(t.String()),
      traits: t.Optional(t.String()),
      responseStyle: t.Optional(t.String()),
    }),
  ),
  terminalShellAdditionalCommands: t.Optional(t.String()),
  terminalShellAllowedCommands: t.Optional(t.String()),
  seedTurns: t.Optional(
    t.Array(
      t.Object({
        role: t.Union([t.Literal("user"), t.Literal("assistant")]),
        content: t.String(),
      }),
    ),
  ),
  mcpServerIds: t.Optional(t.Array(t.String())),
  agentTools: t.Optional(t.Array(t.Unknown())),
  dynamicSubAgents: t.Optional(t.Object({ enabled: t.Boolean(), maxIterations: t.Optional(t.Number()) })),
  additionalToolNames: t.Optional(t.String()),
  terminalTools: t.Optional(t.Boolean()),
  skills: t.Optional(t.Object({ paths: t.Array(t.String()), activate: t.Optional(t.Array(t.String())) })),
  // ── Parity fields (previously dropped before the DB — see
  //    wiki/Research/Audit-Reports-2026-06-09/cortex-agent-quality-parity-audit.md) ──
  numCtx: t.Optional(t.Number()),
  /** `null` clears the override back to auto. */
  thinking: t.Optional(t.Union([t.Boolean(), t.Null()])),
  minIterations: t.Optional(t.Number()),
  memory: t.Optional(
    t.Object({
      working: t.Optional(t.Boolean()),
      episodic: t.Optional(t.Boolean()),
      semantic: t.Optional(t.Boolean()),
    }),
  ),
  metaTools: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      brief: t.Optional(t.Boolean()),
      find: t.Optional(t.Boolean()),
      pulse: t.Optional(t.Boolean()),
      recall: t.Optional(t.Boolean()),
      harnessSkill: t.Optional(t.Boolean()),
      todo: t.Optional(t.Boolean()),
      todoGuidance: t.Optional(t.Object({ reminder: t.Optional(t.Boolean()), systemLine: t.Optional(t.Boolean()) })),
    }),
  ),
  observability: t.Optional(t.Object({ checklist: t.Optional(t.Boolean()) })),
  fallbacks: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      providers: t.Optional(t.Array(t.String())),
      errorThreshold: t.Optional(t.Number()),
    }),
  ),
  observabilityVerbosity: t.Optional(
    t.Union([t.Literal("off"), t.Literal("minimal"), t.Literal("normal"), t.Literal("verbose")]),
  ),
  taskContext: t.Optional(t.Record(t.String(), t.String())),
  healthCheck: t.Optional(t.Boolean()),
  timeout: t.Optional(t.Number()),
  retryPolicy: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      maxRetries: t.Number(),
      backoffMs: t.Optional(t.Number()),
    }),
  ),
});

function chatErrorStatus(e: unknown, msg: string): 400 | 404 | 409 | 500 {
  if (e instanceof ChatSessionBusyError) return 409;
  if (msg.startsWith("Invalid to-do")) return 400;
  return msg.includes("not found") ? 404 : 500;
}

const goalFailureStatus = (f: GoalFailure): 400 | 404 | 409 => (f.code === "invalid" ? 400 : f.code === "not-found" ? 404 : 409);

/** 409 body naming the goal that owns the session, or null when user turns are allowed. */
function goalTurnBlock(goals: ChatGoalService | undefined, sessionId: string): { error: string } | null {
  const g = goals?.activeGoal(sessionId);
  return g ? { error: `Session is pursuing a goal: "${g.objective}". Pause or cancel the goal to chat.` } : null;
}

export const chatRouter = (svc: ChatSessionService, schedules?: ChatScheduleService, goals?: ChatGoalService) =>
  new Elysia({ prefix: "/api/chat" })
    .get("/sessions", () => svc.listSessions())
    .post(
      "/sessions",
      async ({ body, set }) => {
        try {
          const sessionId = await svc.createSession({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.seedTurns?.length ? { seedTurns: body.seedTurns } : {}),
            agentConfig: {
              provider: body.provider ?? "anthropic",
              ...(body.model ? { model: body.model } : {}),
              ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
              ...(body.temperature != null ? { temperature: body.temperature } : {}),
              ...(body.maxTokens ? { maxTokens: body.maxTokens } : {}),
              ...(body.tools?.length ? { tools: body.tools } : {}),
              ...(body.runId !== undefined && body.runId !== "" ? { runId: body.runId } : {}),
              ...(body.enableTools !== undefined ? { enableTools: body.enableTools } : {}),
              ...(body.streamReasoningSteps === true ? { streamReasoningSteps: true } : {}),
              ...(body.autoName === false ? { autoName: false } : {}),
              ...(body.traceRuns === false ? { traceRuns: false } : {}),
              ...(body.maxIterations != null && body.maxIterations > 0
                ? { maxIterations: body.maxIterations }
                : {}),
              ...(typeof body.strategy === "string" && body.strategy.trim() !== ""
                ? { strategy: body.strategy.trim() }
                : {}),
              ...(body.strategySwitching != null ? { strategySwitching: body.strategySwitching } : {}),
              ...(body.runtimeVerification != null ? { runtimeVerification: body.runtimeVerification } : {}),
              ...(body.budget ? { budget: body.budget } : {}),
              ...(body.grounding ? { grounding: body.grounding } : {}),
              ...(body.fabricationGuard ? { fabricationGuard: body.fabricationGuard } : {}),
              ...(body.modelRouting ? { modelRouting: body.modelRouting } : {}),
              ...(body.outputSchema ? { outputSchema: body.outputSchema } : {}),
              ...(body.harness ? { harness: body.harness } : {}),
              ...(body.documents ? { documents: body.documents } : {}),
              ...(body.auditRationale != null ? { auditRationale: body.auditRationale } : {}),
              ...(body.verificationStep ? { verificationStep: body.verificationStep } : {}),
              ...(body.contextSynthesis ? { contextSynthesis: body.contextSynthesis } : {}),
              ...(body.guardrails ? { guardrails: body.guardrails } : {}),
              ...(body.persona ? { persona: body.persona } : {}),
              ...(typeof body.terminalShellAdditionalCommands === "string" &&
              body.terminalShellAdditionalCommands.trim() !== ""
                ? { terminalShellAdditionalCommands: body.terminalShellAdditionalCommands.trim() }
                : {}),
              ...(typeof body.terminalShellAllowedCommands === "string" &&
              body.terminalShellAllowedCommands.trim() !== ""
                ? { terminalShellAllowedCommands: body.terminalShellAllowedCommands.trim() }
                : {}),
              ...(body.mcpServerIds?.length ? { mcpServerIds: body.mcpServerIds } : {}),
              ...(body.agentTools?.length ? { agentTools: body.agentTools } : {}),
              ...(body.dynamicSubAgents ? { dynamicSubAgents: body.dynamicSubAgents } : {}),
              ...(body.additionalToolNames ? { additionalToolNames: body.additionalToolNames } : {}),
              ...(body.terminalTools === true ? { terminalTools: true } : {}),
              ...(body.skills?.paths.length ? { skills: body.skills } : {}),
              ...(typeof body.numCtx === "number" && body.numCtx > 0 ? { numCtx: body.numCtx } : {}),
              ...(typeof body.thinking === "boolean" ? { thinking: body.thinking } : {}),
              ...(typeof body.minIterations === "number" && body.minIterations > 0
                ? { minIterations: body.minIterations }
                : {}),
              ...(body.memory ? { memory: body.memory } : {}),
              ...(body.metaTools ? { metaTools: body.metaTools } : {}),
              ...(body.observability ? { observability: body.observability } : {}),
              ...(body.fallbacks ? { fallbacks: body.fallbacks } : {}),
              ...(body.observabilityVerbosity
                ? { observabilityVerbosity: body.observabilityVerbosity }
                : {}),
              ...(body.taskContext && Object.keys(body.taskContext).length > 0
                ? { taskContext: body.taskContext }
                : {}),
              ...(body.healthCheck === true ? { healthCheck: true } : {}),
              ...(typeof body.timeout === "number" && body.timeout > 0 ? { timeout: body.timeout } : {}),
              ...(body.retryPolicy?.enabled === true ? { retryPolicy: body.retryPolicy } : {}),
            },
          });
          return { sessionId };
        } catch (e) {
          set.status = 500;
          return { error: String(e) };
        }
      },
      {
        body: ChatSessionConfigBody,
      },
    )
    // Chat utilities. History mutations 409 while a turn is in flight.
    .post(
      "/sessions/:sessionId/rewind",
      async ({ params, body, set }) => {
        try {
          return await svc.rewind(params.sessionId, body.turnId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      { body: t.Object({ turnId: t.Number() }) },
    )
    .post("/sessions/:sessionId/clear", async ({ params, set }) => {
      try {
        return await svc.clear(params.sessionId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set.status = chatErrorStatus(e, msg);
        return { error: msg };
      }
    })
    .post(
      "/sessions/:sessionId/fork",
      async ({ params, body, set }) => {
        try {
          const sessionId = await svc.fork(params.sessionId, {
            ...(body.atTurnId !== undefined ? { atTurnId: body.atTurnId } : {}),
            ...(body.name ? { name: body.name } : {}),
          });
          return { sessionId };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      { body: t.Object({ atTurnId: t.Optional(t.Number()), name: t.Optional(t.String()) }) },
    )
    .post(
      "/sessions/:sessionId/compact",
      async ({ params, body, set }) => {
        try {
          return await svc.compact(params.sessionId, body.keepLast !== undefined ? { keepLast: body.keepLast } : {});
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      { body: t.Object({ keepLast: t.Optional(t.Number()) }) },
    )
    .patch(
      "/sessions/:sessionId/summary",
      async ({ params, body, set }) => {
        try {
          await svc.editSummary(params.sessionId, body.turnId, body.content);
          return { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      { body: t.Object({ turnId: t.Number(), content: t.String() }) },
    )
    // Conversation-level to-do list: replace (PUT) or clear (DELETE). The next turn is seeded from it.
    .put(
      "/sessions/:sessionId/todo",
      async ({ params, body, set }) => {
        try {
          return { todo: await svc.setTodo(params.sessionId, body.items) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      {
        body: t.Object({
          items: t.Array(
            t.Object({
              id: t.String(),
              title: t.String(),
              status: t.Union([t.Literal("pending"), t.Literal("in_progress"), t.Literal("completed")]),
            }),
          ),
        }),
      },
    )
    .post(
      "/sessions/:sessionId/schedules",
      ({ params, body, set }) => {
        if (!schedules) {
          set.status = 501;
          return { error: "Schedules are not enabled" };
        }
        const r = schedules.create({
          sessionId: params.sessionId,
          kind: body.kind,
          spec: body.spec,
          prompt: body.prompt,
          ...(body.ttlMs !== undefined ? { ttlMs: body.ttlMs } : {}),
          ...(body.maxCostUsd !== undefined ? { maxCostUsd: body.maxCostUsd } : {}),
        });
        if (!r.ok) {
          set.status = r.code === "invalid" ? 400 : r.code === "cap" ? 409 : 404;
          return { error: r.message };
        }
        return { schedule: r.schedule };
      },
      {
        body: t.Object({
          kind: t.Union([t.Literal("loop"), t.Literal("cron")]),
          spec: t.String(),
          prompt: t.String(),
          ttlMs: t.Optional(t.Number()),
          maxCostUsd: t.Optional(t.Number()),
        }),
      },
    )
    .get("/sessions/:sessionId/schedules", ({ params, set }) => {
      if (!schedules) {
        set.status = 501;
        return { error: "Schedules are not enabled" };
      }
      return { schedules: schedules.list(params.sessionId) };
    })
    .delete("/sessions/:sessionId/schedules/:scheduleId", ({ params, set }) => {
      if (!schedules) {
        set.status = 501;
        return { error: "Schedules are not enabled" };
      }
      if (!schedules.remove(params.sessionId, params.scheduleId)) {
        set.status = 404;
        return { error: "Schedule not found" };
      }
      return { ok: true };
    })
    // Goal supervisor: propose -> accept -> segments run as ordinary turns. UI polls GET /goal.
    .get("/sessions/:sessionId/goal", ({ params, set }) => {
      if (!goals) {
        set.status = 501;
        return { error: "Goals are not enabled" };
      }
      const rec = goals.get(params.sessionId);
      return { goal: rec?.goal ?? null, goalAchieved: rec?.goalAchieved ?? null, reason: rec?.reason ?? null };
    })
    .post(
      "/sessions/:sessionId/goal",
      ({ params, body, set }) => {
        if (!goals) {
          set.status = 501;
          return { error: "Goals are not enabled" };
        }
        const r = goals.propose(params.sessionId, {
          objective: body.objective,
          ...(body.criteria ? { criteria: body.criteria } : {}),
          ...(body.budget ? { budget: body.budget } : {}),
        });
        if (!r.ok) {
          set.status = goalFailureStatus(r);
          return { error: r.message };
        }
        return { goal: r.goal, goalAchieved: r.goalAchieved, reason: r.reason };
      },
      {
        body: t.Object({
          objective: t.String(),
          criteria: t.Optional(
            t.Array(
              t.Object({
                id: t.Optional(t.String()),
                text: t.String(),
                check: t.Union([
                  t.Object({ kind: t.Literal("regex"), pattern: t.String() }),
                  t.Object({ kind: t.Literal("must-include"), value: t.String() }),
                  t.Object({ kind: t.Literal("rubric") }),
                ]),
              }),
            ),
          ),
          budget: t.Optional(
            t.Object({
              maxSegments: t.Optional(t.Number()),
              maxCostUsd: t.Optional(t.Number()),
              maxTokens: t.Optional(t.Number()),
              maxWallClockMs: t.Optional(t.Number()),
            }),
          ),
        }),
      },
    )
    .post("/sessions/:sessionId/goal/:action", ({ params, set }) => {
      if (!goals) {
        set.status = 501;
        return { error: "Goals are not enabled" };
      }
      const r =
        params.action === "accept" ? goals.accept(params.sessionId)
        : params.action === "pause" ? goals.pause(params.sessionId)
        : params.action === "resume" ? goals.resume(params.sessionId)
        : params.action === "cancel" ? goals.cancel(params.sessionId)
        : undefined;
      if (!r) {
        set.status = 404;
        return { error: `Unknown goal action "${params.action}"` };
      }
      if (!r.ok) {
        set.status = goalFailureStatus(r);
        return { error: r.message };
      }
      return { goal: r.goal, goalAchieved: r.goalAchieved, reason: r.reason };
    })
    .delete("/sessions/:sessionId/todo", async ({ params, set }) => {
      try {
        return { todo: await svc.setTodo(params.sessionId, []) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set.status = chatErrorStatus(e, msg);
        return { error: msg };
      }
    })
    .get("/sessions/:sessionId", ({ params, set }) => {
      const session = svc.getSession(params.sessionId);
      if (!session) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return session;
    })
    // Real framework trace (JSONL) of one assistant turn: root run, then each sub-agent run it spawned.
    .get("/sessions/:sessionId/turns/:turnId/trace", ({ params, set }) => {
      const session = svc.getSession(params.sessionId);
      const turn = session?.turns.find((t) => String(t.id) === params.turnId && t.role === "assistant");
      if (!turn) {
        set.status = 404;
        return { error: "Turn not found" };
      }
      const runs = turn.runId ? readRunTreeTraces(turn.runId) : [];
      if (runs.length === 0) {
        set.status = 404;
        return { error: "No trace recorded for this turn" };
      }
      return new Response(runs.map((r) => (r.raw.endsWith("\n") ? r.raw : r.raw + "\n")).join(""), {
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "content-disposition": `attachment; filename="${turn.runId}.jsonl"`,
          "x-trace-source": "tracer",
        },
      });
    })
    // Conversation export: md transcript, json (session + turns + traces), or jsonl (run traces tagged by turnId).
    .get("/sessions/:sessionId/export", ({ params, query, set }) => {
      const session = svc.getSession(params.sessionId);
      if (!session) {
        set.status = 404;
        return { error: "Session not found" };
      }
      const format = query.format ?? "md";
      if (format !== "md" && format !== "json" && format !== "jsonl") {
        set.status = 400;
        return { error: "format must be md, json or jsonl" };
      }
      const slug = slugifyFilename(session.name);
      const disposition = `attachment; filename="${slug}.${format}"`;
      if (format === "md") {
        return new Response(renderChatMarkdown(session, session.turns), {
          headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": disposition },
        });
      }
      const tracesByTurn = new Map<number, ReturnType<typeof readRunTreeTraces>>();
      for (const t of session.turns) {
        if (t.role === "assistant" && t.runId) {
          const runs = readRunTreeTraces(t.runId);
          if (runs.length > 0) tracesByTurn.set(t.id, runs);
        }
      }
      if (format === "json") {
        const traces: Record<string, string> = {};
        for (const [id, runs] of tracesByTurn) traces[String(id)] = runs.map((r) => r.raw).join("");
        return new Response(JSON.stringify({ session: { ...session, turns: undefined }, turns: session.turns, traces }, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8", "content-disposition": disposition },
        });
      }
      const lines: string[] = [];
      for (const [turnId, runs] of tracesByTurn) {
        for (const r of runs) {
          for (const line of r.raw.split("\n")) {
            if (line.trim() === "") continue;
            try {
              lines.push(JSON.stringify({ ...(JSON.parse(line) as Record<string, unknown>), turnId }));
            } catch {
              /* skip a corrupt line rather than failing the export */
            }
          }
        }
      }
      return new Response(lines.length ? lines.join("\n") + "\n" : "", {
        headers: { "content-type": "application/x-ndjson; charset=utf-8", "content-disposition": disposition },
      });
    })
    .delete("/sessions/:sessionId", async ({ params, set }) => {
      const ok = await svc.deleteSession(params.sessionId);
      if (!ok) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return { ok: true };
    })
    .patch(
      "/sessions/:sessionId",
      ({ params, body, set }) => {
        if (!svc.getSession(params.sessionId)) {
          set.status = 404;
          return { error: "Session not found" };
        }
        svc.renameSession(params.sessionId, body.name);
        return { ok: true };
      },
      { body: t.Object({ name: t.String() }) },
    )
    .patch(
      "/sessions/:sessionId/config",
      async ({ params, body, set }) => {
        try {
          await svc.updateSessionConfig(params.sessionId, {
            ...(body.provider !== undefined ? { provider: body.provider } : {}),
            ...(body.model !== undefined ? { model: body.model } : {}),
            ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
            ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
            ...(body.maxTokens !== undefined ? { maxTokens: body.maxTokens } : {}),
            ...(body.tools !== undefined ? { tools: body.tools } : {}),
            ...(body.runId !== undefined ? { runId: body.runId } : {}),
            ...(body.enableTools !== undefined ? { enableTools: body.enableTools } : {}),
            ...(body.autoName !== undefined ? { autoName: body.autoName } : {}),
            ...(body.traceRuns !== undefined ? { traceRuns: body.traceRuns } : {}),
            ...(body.streamReasoningSteps !== undefined
              ? { streamReasoningSteps: body.streamReasoningSteps }
              : {}),
            ...(body.maxIterations !== undefined ? { maxIterations: body.maxIterations } : {}),
            ...(body.strategy !== undefined ? { strategy: body.strategy } : {}),
            ...(body.strategySwitching !== undefined
              ? { strategySwitching: body.strategySwitching }
              : {}),
            ...(body.runtimeVerification !== undefined
              ? { runtimeVerification: body.runtimeVerification }
              : {}),
            ...(body.verificationStep !== undefined ? { verificationStep: body.verificationStep } : {}),
            ...(body.budget !== undefined ? { budget: body.budget } : {}),
            ...(body.grounding !== undefined ? { grounding: body.grounding } : {}),
            ...(body.fabricationGuard !== undefined ? { fabricationGuard: body.fabricationGuard } : {}),
            ...(body.modelRouting !== undefined ? { modelRouting: body.modelRouting } : {}),
            ...(body.outputSchema !== undefined ? { outputSchema: body.outputSchema } : {}),
            ...(body.harness !== undefined ? { harness: body.harness } : {}),
            ...(body.documents !== undefined ? { documents: body.documents } : {}),
            ...(body.auditRationale !== undefined ? { auditRationale: body.auditRationale } : {}),
            ...(body.contextSynthesis !== undefined ? { contextSynthesis: body.contextSynthesis } : {}),
            ...(body.guardrails !== undefined ? { guardrails: body.guardrails } : {}),
            ...(body.persona !== undefined ? { persona: body.persona } : {}),
            ...(body.terminalShellAdditionalCommands !== undefined
              ? { terminalShellAdditionalCommands: body.terminalShellAdditionalCommands }
              : {}),
            ...(body.terminalShellAllowedCommands !== undefined
              ? { terminalShellAllowedCommands: body.terminalShellAllowedCommands }
              : {}),
            ...(body.mcpServerIds !== undefined ? { mcpServerIds: body.mcpServerIds } : {}),
            ...(body.agentTools !== undefined ? { agentTools: body.agentTools } : {}),
            ...(body.dynamicSubAgents !== undefined ? { dynamicSubAgents: body.dynamicSubAgents } : {}),
            ...(body.additionalToolNames !== undefined
              ? { additionalToolNames: body.additionalToolNames }
              : {}),
            ...(body.terminalTools !== undefined ? { terminalTools: body.terminalTools } : {}),
            ...(body.skills !== undefined ? { skills: body.skills } : {}),
            ...(body.numCtx !== undefined ? { numCtx: body.numCtx } : {}),
            ...(body.thinking !== undefined ? { thinking: body.thinking } : {}),
            ...(body.minIterations !== undefined ? { minIterations: body.minIterations } : {}),
            ...(body.memory !== undefined ? { memory: body.memory } : {}),
            ...(body.metaTools !== undefined ? { metaTools: body.metaTools } : {}),
            ...(body.observability !== undefined ? { observability: body.observability } : {}),
            ...(body.fallbacks !== undefined ? { fallbacks: body.fallbacks } : {}),
            ...(body.observabilityVerbosity !== undefined
              ? { observabilityVerbosity: body.observabilityVerbosity }
              : {}),
            ...(body.taskContext !== undefined ? { taskContext: body.taskContext } : {}),
            ...(body.healthCheck !== undefined ? { healthCheck: body.healthCheck } : {}),
            ...(body.timeout !== undefined ? { timeout: body.timeout } : {}),
            ...(body.retryPolicy !== undefined ? { retryPolicy: body.retryPolicy } : {}),
          });
          return { ok: true };
        } catch (e) {
          const msg = String(e);
          set.status = msg.includes("not found") ? 404 : 500;
          return { error: msg };
        }
      },
      {
        body: ChatSessionConfigBody,
      },
    )
    .post(
      "/sessions/:sessionId/chat",
      async ({ params, body, set }) => {
        const blocked = goalTurnBlock(goals, params.sessionId);
        if (blocked) {
          set.status = 409;
          return blocked;
        }
        try {
          const result = await svc.chat(params.sessionId, body.message);
          return result;
        } catch (e) {
          const msg = String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      {
        body: t.Object({ message: t.String() }),
      },
    )
    .post(
      "/sessions/:sessionId/chat/stream",
      async ({ params, body, set, request }) => {
        const blocked = goalTurnBlock(goals, params.sessionId);
        if (blocked) {
          set.status = 409;
          return blocked;
        }
        try {
          const enc = new TextEncoder();
          const readable = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                for await (const event of svc.chatStream(params.sessionId, body.message, request?.signal)) {
                  // Stream the event as SSE
                  controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));

                  if (event._tag === "StreamCompleted" || event._tag === "StreamError") {
                    controller.close();
                    return;
                  }
                }
              } catch (e) {
                try {
                  const errorEvent = {
                    _tag: "StreamError" as const,
                    cause: String(e),
                  };
                  controller.enqueue(enc.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
                  controller.close();
                } catch {
                  // controller already closed
                }
              }
            },
          });
          return new Response(readable, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (e) {
          const msg = String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      {
        body: t.Object({ message: t.String() }),
      },
    );
