import { Elysia, t } from "elysia";
import { ChatSessionBusyError, type ChatSessionService } from "../services/chat-session-service.js";
import { DetachedTurns, sseFrame, type DetachedTurn } from "../services/chat-detached-turn.js";
import { readRunTreeTraces } from "../services/run-trace-file.js";
import type { ChatScheduleService } from "../services/chat-schedule-service.js";
import type { ChatGoalService, GoalFailure } from "../services/chat-goal-service.js";
import type { ChatBtwService } from "../services/chat-btw.js";
import type { ChatProposalService, ProposalResult } from "../services/chat-proposal-service.js";
import { renderChatMarkdown, slugifyFilename } from "../services/chat-export.js";
import { withCheckedWorkspace } from "../services/workspace-dir.js";
import { buildTurnInput, inputCapabilitiesOf } from "../services/chat-attachments.js";
import { attachmentsSchema } from "./chat-attachments-schema.js";
import { readWorkspaceText, searchWorkspaceFiles } from "../services/workspace-files.js";
import { AgentConfigBodyFields } from "./agent-config-body.js";
import { parseCortexSkillsConfig } from "../services/cortex-agent-config.js";

/**
 * Body schema for chat session create / PATCH config: the chat-session switches plus
 * the shared {@link AgentConfigBodyFields} that `RunConfigBody` also spreads.
 */
export const ChatSessionConfigBody = t.Object({
  name: t.Optional(t.String()),
  runId: t.Optional(t.String()),
  enableTools: t.Optional(t.Boolean()),
  streamReasoningSteps: t.Optional(t.Boolean()),
  /** Auto-name the chat from its first exchange (default on). */
  autoName: t.Optional(t.Boolean()),
  environmentUpdates: t.Optional(t.Boolean()),
  /** Persist a framework JSONL run trace per chat turn (default on). */
  traceRuns: t.Optional(t.Boolean()),
  seedTurns: t.Optional(
    t.Array(
      t.Object({
        role: t.Union([t.Literal("user"), t.Literal("assistant")]),
        content: t.String(),
      }),
    ),
  ),
  /** Let the chat agent propose session changes (model, goals, loops...) via the `session-control` tool. Default off. */
  agentControl: t.Optional(t.Boolean()),
  /** Extra capability groups the agent may propose in (`session-capabilities.ts`); needs `agentControl`. Default none. */
  agentControlGroups: t.Optional(t.Array(t.String())),
  /** Groups whose TIGHTENING proposals apply without a click. A loosening change always needs Apply. Default none. */
  agentControlAutoApply: t.Optional(t.Array(t.String())),
  ...AgentConfigBodyFields,
});

function chatErrorStatus(e: unknown, msg: string): 400 | 404 | 409 | 500 {
  if (e instanceof ChatSessionBusyError) return 409;
  if (msg.startsWith("Invalid to-do")) return 400;
  return msg.includes("not found") ? 404 : 500;
}

/** Per-turn run posture from the request body. `undefined` = absent (default execute); `null` = invalid. */
export function parsePosture(raw: string | undefined): "execute" | "plan" | undefined | null {
  if (raw === undefined) return undefined;
  return raw === "execute" || raw === "plan" ? raw : null;
}

const goalFailureStatus = (f: GoalFailure): 400 | 404 | 409 => (f.code === "invalid" ? 400 : f.code === "not-found" ? 404 : 409);

/** 409 body naming the goal that owns the session, or null when user turns are allowed. */
function goalTurnBlock(goals: ChatGoalService | undefined, sessionId: string): { error: string } | null {
  const g = goals?.activeGoal(sessionId);
  return g ? { error: `Session is pursuing a goal: "${g.objective}". Pause or cancel the goal to chat.` } : null;
}

/** Proposal result -> HTTP: 404 unknown, 409 not `proposed`, 422 apply failed (proposal stays `proposed` with `error`). */
function proposalResponse(r: ProposalResult, set: { status?: number | string }): { proposal?: unknown; error?: string } {
  if (r.ok) return { proposal: r.proposal };
  set.status = r.code === "not-found" ? 404 : r.code === "conflict" ? 409 : 422;
  return { ...(r.proposal ? { proposal: r.proposal } : {}), error: r.message };
}

/** An SSE response over a detached turn from `fromId`; the connection closing only detaches this reader. */
function sseResponse(turn: DetachedTurn, fromId: number): Response {
  const enc = new TextEncoder();
  const leave = new AbortController();
  const frames = turn.attach(fromId, leave.signal)[Symbol.asyncIterator]();
  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await frames.next();
      if (next.done) controller.close();
      else controller.enqueue(enc.encode(sseFrame(next.value)));
    },
    cancel() {
      leave.abort();
    },
  });
  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}

export const chatRouter = (svc: ChatSessionService, schedules?: ChatScheduleService, goals?: ChatGoalService, proposals?: ChatProposalService, btw?: ChatBtwService, detachedTurns: DetachedTurns = new DetachedTurns()) => {
  return new Elysia({ prefix: "/api/chat" })
    .get("/sessions", () => svc.listSessions())
    .post(
      "/sessions",
      async ({ body: rawBody, set }) => {
        const checked = withCheckedWorkspace(rawBody);
        if (!checked.ok) {
          set.status = 400;
          return { error: checked.error };
        }
        const body = checked.patch;
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
              ...(body.environmentUpdates === false ? { environmentUpdates: false } : {}),
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
              ...(body.judgment ? { judgment: body.judgment } : {}),
              ...(body.modelRouting ? { modelRouting: body.modelRouting } : {}),
              ...(body.outputSchema ? { outputSchema: body.outputSchema } : {}),
              ...(body.outputSchemaOnParseFail ? { outputSchemaOnParseFail: body.outputSchemaOnParseFail } : {}),
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
              ...(() => {
                const skills = parseCortexSkillsConfig(body.skills);
                return skills ? { skills } : {};
              })(),
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
              ...(body.agentControl === true ? { agentControl: true } : {}),
              ...(body.agentControlGroups ? { agentControlGroups: body.agentControlGroups } : {}),
              ...(body.agentControlAutoApply ? { agentControlAutoApply: body.agentControlAutoApply } : {}),
              ...(body.healthCheck === true ? { healthCheck: true } : {}),
              ...(typeof body.timeout === "number" && body.timeout > 0 ? { timeout: body.timeout } : {}),
              ...(body.retryPolicy?.enabled === true ? { retryPolicy: body.retryPolicy } : {}),
              ...(body.terminalShellOptions ? { terminalShellOptions: body.terminalShellOptions } : {}),
              ...(body.workspace ? { workspace: body.workspace } : {}),
              ...(body.rawConfig && Object.keys(body.rawConfig).length > 0 ? { rawConfig: body.rawConfig } : {}),
              ...(body.durableRuns?.enabled ? { durableRuns: body.durableRuns } : {}),
              // normalizeCortexAgentConfig moves a legacy durableRuns gate here.
              ...(body.approvalPolicy ? { approvalPolicy: body.approvalPolicy } : {}),
              ...(body.askBeforeRiskyTools === false ? { askBeforeRiskyTools: false } : {}),
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
    // `/btw`: a read-only side question about the run in progress (or the last turn); never touches the session or its history.
    .post(
      "/sessions/:sessionId/btw",
      async ({ params, body, set }) => {
        if (!btw) {
          set.status = 501;
          return { error: "Side questions are not available on this server" };
        }
        const out = await btw.answer(params.sessionId, body.question, body.context);
        if (!out.ok) {
          set.status = out.status;
          return { error: out.error };
        }
        return { answer: out.answer, running: out.running };
      },
      {
        body: t.Object({
          question: t.String(),
          context: t.Optional(
            t.Object({
              task: t.String(),
              running: t.Boolean(),
              draft: t.String(),
              steps: t.Array(t.Object({ tool: t.String(), args: t.Optional(t.String()), result: t.Optional(t.String()), failed: t.Optional(t.Boolean()) })),
            }),
          ),
        }),
      },
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
    // Agent-proposed session changes (session-control tool). Apply is the only path to a mutation.
    .get("/sessions/:sessionId/proposals", ({ params, set }) => {
      if (!proposals) {
        set.status = 501;
        return { error: "Proposals are not enabled" };
      }
      return { proposals: proposals.list(params.sessionId) };
    })
    .post("/sessions/:sessionId/proposals/:proposalId/apply", async ({ params, set }) => {
      if (!proposals) {
        set.status = 501;
        return { error: "Proposals are not enabled" };
      }
      return proposalResponse(await proposals.apply(params.sessionId, params.proposalId), set);
    })
    .post("/sessions/:sessionId/proposals/:proposalId/dismiss", ({ params, set }) => {
      if (!proposals) {
        set.status = 501;
        return { error: "Proposals are not enabled" };
      }
      return proposalResponse(proposals.dismiss(params.sessionId, params.proposalId), set);
    })
    // Remove a banner from the thread (a settled one the user is done with; a pending one is dropped unapplied).
    .delete("/sessions/:sessionId/proposals/:proposalId", ({ params, set }) => {
      if (!proposals) {
        set.status = 501;
        return { error: "Proposals are not enabled" };
      }
      return proposalResponse(proposals.remove(params.sessionId, params.proposalId), set);
    })
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
        // The schema-validated body IS the patch: every config key passes through as sent
        // (normalizeCortexAgentConfig cleans it). `name` / `seedTurns` are create-only.
        const { name: _name, seedTurns: _seedTurns, ...fields } = body;
        const checked = withCheckedWorkspace(fields);
        if (!checked.ok) {
          set.status = 400;
          return { error: checked.error };
        }
        try {
          await svc.updateSessionConfig(params.sessionId, checked.patch);
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
    // Turns paused on a durable approval gate (chat-approvals.ts). Approve / deny resume the
    // run and land its reply in the thread; dismiss drops the paused turn without resuming.
    .get("/sessions/:sessionId/approvals", ({ params, set }) => {
      if (!svc.getSession(params.sessionId)) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return { approvals: svc.approvals.list(params.sessionId) };
    })
    .post(
      "/sessions/:sessionId/approvals/:runId/:decision",
      async ({ params, body, set }) => {
        if (params.decision === "dismiss") {
          const ok = await svc.approvals.dismiss(params.sessionId, params.runId);
          if (!ok) set.status = 404;
          return ok ? { ok: true } : { error: "No paused turn with that run id" };
        }
        if (params.decision !== "approve" && params.decision !== "deny") {
          set.status = 400;
          return { error: `Unknown decision "${params.decision}": expected approve, deny or dismiss` };
        }
        const out = await svc.approvals.resolve(
          params.sessionId,
          params.runId,
          params.decision === "approve" ? "approved" : "denied",
          body?.reason,
        );
        if (out.ok) return out;
        set.status = out.code === "not-found" ? 404 : out.code === "busy" ? 409 : 422;
        return { error: out.message };
      },
      { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
    )
    // Turns paused on request_user_input (chat-approvals.ts). Respond resumes the run with the
    // user's answer; the question, the answer and the reply land in the thread. Dismiss drops it.
    .post(
      "/sessions/:sessionId/interactions/:runId/:verb",
      async ({ params, body, set }) => {
        if (params.verb === "dismiss") {
          const ok = await svc.approvals.dismiss(params.sessionId, params.runId);
          if (!ok) set.status = 404;
          return ok ? { ok: true } : { error: "No paused turn with that run id" };
        }
        if (params.verb !== "respond") {
          set.status = 400;
          return { error: `Unknown action "${params.verb}": expected respond or dismiss` };
        }
        if (body?.value === undefined) {
          set.status = 400;
          return { error: "respond needs a value" };
        }
        const out = await svc.approvals.respond(params.sessionId, params.runId, body.value);
        if (out.ok) return out;
        set.status = out.code === "not-found" ? 404 : out.code === "busy" ? 409 : 422;
        return { error: out.message };
      },
      { body: t.Optional(t.Object({ value: t.Optional(t.Unknown()) })) },
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
          const posture = parsePosture(body.posture);
          if (posture === null) {
            set.status = 400;
            return { error: `Invalid posture "${body.posture}": expected "execute" or "plan"` };
          }
          const result = await svc.chat(params.sessionId, body.message, posture !== undefined ? { posture } : {});
          return result;
        } catch (e) {
          const msg = String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      {
        body: t.Object({ message: t.String(), posture: t.Optional(t.String()) }),
      },
    )
    // Stop the session's streamed turn. The run is aborted server-side and the turn is
    // stored as interrupted by the user; a client that only drops the stream reads as a
    // disconnect (chat-turn-stop.ts).
    .post("/sessions/:sessionId/chat/stop", ({ params }) => ({ stopped: svc.stopTurn(params.sessionId) }))
    // The session's streamed turn that is still running (a reloaded page asks, then attaches).
    // `message` is the user message the turn answers: it is stored with the turn only when it ends.
    .get("/sessions/:sessionId/chat/active", ({ params }) => {
      const turn = detachedTurns.running(params.sessionId);
      return turn ? { active: true as const, message: turn.message, startedAt: turn.startedAt } : { active: false as const };
    })
    // Attach to the session's turn: replay its buffered events, then follow it live. `cursor` is the
    // last event id the client saw (SSE `id:`); events after it are sent. 404 when there is no turn
    // (it ended and aged out: the stored turn is in the session's history).
    .get(
      "/sessions/:sessionId/chat/stream/active",
      ({ params, query, set }) => {
        const turn = detachedTurns.get(params.sessionId);
        if (!turn) {
          set.status = 404;
          return { error: "No turn to attach to" };
        }
        const cursor = query.cursor !== undefined ? Number(query.cursor) : undefined;
        return sseResponse(turn, cursor !== undefined && Number.isFinite(cursor) ? cursor + 1 : 0);
      },
      { query: t.Object({ cursor: t.Optional(t.String()) }) },
    )
    .post(
      "/sessions/:sessionId/chat/stream",
      async ({ params, body, set }) => {
        const blocked = goalTurnBlock(goals, params.sessionId);
        if (blocked) {
          set.status = 409;
          return blocked;
        }
        const posture = parsePosture(body.posture);
        if (posture === null) {
          set.status = 400;
          return { error: `Invalid posture "${body.posture}": expected "execute" or "plan"` };
        }
        // Refuse before opening the stream so the client gets a plain 409, not a StreamError frame.
        if (svc.approvals.hasPending(params.sessionId)) {
          set.status = 409;
          return { error: "A turn in this session is awaiting approval or your reply: answer it first" };
        }
        // One turn in flight per session; a second sender attaches instead (GET .../chat/stream/active).
        if (detachedTurns.running(params.sessionId)) {
          set.status = 409;
          return { error: "A turn in this session is already running: reattach to it" };
        }
        // Pictures, audio, text files and tagged workspace files become the turn's input; a refusal
        // (type, size, count, a model that cannot take it, a path outside the workspace) is a plain
        // 4xx before any run starts.
        const hasAttachments = (body.attachments?.uploads?.length ?? 0) + (body.attachments?.files?.length ?? 0) > 0;
        // The session (all its turns) is read only when there is something attached.
        const cfg = hasAttachments ? (svc.sessionConfig(params.sessionId) ?? {}) : {};
        const built = buildTurnInput({
          message: body.message,
          attachments: body.attachments,
          workspaceRoot: typeof cfg["workspace"] === "string" ? cfg["workspace"] : undefined,
          provider: typeof cfg["provider"] === "string" ? cfg["provider"] : "",
          model: typeof cfg["model"] === "string" ? cfg["model"] : "",
        });
        if (!built.ok) {
          set.status = built.status;
          return { error: built.error, code: built.code, ...(built.partType ? { partType: built.partType } : {}) };
        }
        try {
          // The turn runs to its end whether or not this connection stays open (chat-detached-turn.ts):
          // closing or reloading the page no longer aborts it, so a wait on an approval or a question
          // survives. The request's own signal is deliberately not passed; Stop is explicit.
          const turn = detachedTurns.start(
            params.sessionId,
            body.message,
            svc.chatStream(params.sessionId, body.message, undefined, posture, {
              ...(body.skills ? { skills: body.skills } : {}),
              ...(built.meta.length > 0 ? { input: built.input, attachments: built.meta } : {}),
            }),
          );
          return sseResponse(turn, 0);
        } catch (e) {
          const msg = String(e);
          set.status = chatErrorStatus(e, msg);
          return { error: msg };
        }
      },
      {
        // `skills`: skill names pinned for this turn only (`/skill <name>`).
        // `attachments`: uploads (base64) and tagged workspace files, see chat-attachments.ts.
        body: t.Object({
          message: t.String(),
          posture: t.Optional(t.String()),
          skills: t.Optional(t.Array(t.String())),
          // Item count and string lengths are limited in the schema (chat-attachments-schema.ts).
          attachments: t.Optional(attachmentsSchema),
        }),
      },
    )
    // The model's input capabilities for this chat (vision, audio in): the composer disables what it cannot take.
    .get("/sessions/:sessionId/input-capabilities", ({ params, set }) => {
      const cfg = svc.sessionConfig(params.sessionId);
      if (!cfg) {
        set.status = 404;
        return { error: "Session not found" };
      }
      const provider = typeof cfg["provider"] === "string" ? cfg["provider"] : "";
      const model = typeof cfg["model"] === "string" ? cfg["model"] : "";
      return { capabilities: inputCapabilitiesOf(provider, model) };
    })
    // `@` picker: fuzzy search over the session's workspace files (confined, secrets and build output excluded).
    .get(
      "/sessions/:sessionId/files",
      ({ params, query, set }) => {
        const root = workspaceRootOf(svc, params.sessionId);
        if (root === null) {
          set.status = 404;
          return { error: "Session not found" };
        }
        if (root === "") return { workspace: null, files: [], truncated: false };
        const limit = query.limit !== undefined ? Number(query.limit) : 30;
        return { workspace: root, ...searchWorkspaceFiles(root, query.q ?? "", Number.isFinite(limit) ? limit : 30) };
      },
      { query: t.Object({ q: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
    )
    // Preview of one tagged file (bounded; binary refused), shown before send.
    .get(
      "/sessions/:sessionId/files/preview",
      ({ params, query, set }) => {
        const root = workspaceRootOf(svc, params.sessionId);
        if (root === null || root === "") {
          set.status = root === null ? 404 : 400;
          return { error: root === null ? "Session not found" : "This chat has no workspace" };
        }
        const read = readWorkspaceText(root, query.path);
        if (!read.ok) {
          set.status = read.code === "not-found" ? 404 : 400;
          return { error: read.error, code: read.code };
        }
        return read;
      },
      { query: t.Object({ path: t.String() }) },
    );
};

/** The session's workspace root: `null` when the session is unknown, `""` when it has none. */
function workspaceRootOf(svc: ChatSessionService, sessionId: string): string | null {
  const cfg = svc.sessionConfig(sessionId);
  if (!cfg) return null;
  const ws = cfg["workspace"];
  return typeof ws === "string" ? ws : "";
}
