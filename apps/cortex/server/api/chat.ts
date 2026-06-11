import { Elysia, t } from "elysia";
import type { ChatSessionService } from "../services/chat-session-service.js";
import type { AgentStreamEvent } from "@reactive-agents/runtime";

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
  maxIterations: t.Optional(t.Number()),
  strategy: t.Optional(t.String()),
  strategySwitching: t.Optional(t.Boolean()),
  runtimeVerification: t.Optional(t.Boolean()),
  auditRationale: t.Optional(t.Boolean()),
  verificationStep: t.Optional(t.Union([t.Literal("none"), t.Literal("reflect")])),
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
  skills: t.Optional(t.Object({ paths: t.Array(t.String()) })),
  // ── Parity fields (previously dropped before the DB — see
  //    wiki/Research/Audit-Reports-2026-06-09/cortex-agent-quality-parity-audit.md) ──
  numCtx: t.Optional(t.Number()),
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
    }),
  ),
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
  cacheTimeout: t.Optional(t.Number()),
  progressCheckpoint: t.Optional(t.Number()),
  retryPolicy: t.Optional(
    t.Object({
      enabled: t.Optional(t.Boolean()),
      maxRetries: t.Number(),
      backoffMs: t.Optional(t.Number()),
    }),
  ),
});

export const chatRouter = (svc: ChatSessionService) =>
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
              ...(body.enableTools === true ? { enableTools: true } : {}),
              ...(body.streamReasoningSteps === true ? { streamReasoningSteps: true } : {}),
              ...(body.maxIterations != null && body.maxIterations > 0
                ? { maxIterations: body.maxIterations }
                : {}),
              ...(typeof body.strategy === "string" && body.strategy.trim() !== ""
                ? { strategy: body.strategy.trim() }
                : {}),
              ...(body.strategySwitching != null ? { strategySwitching: body.strategySwitching } : {}),
              ...(body.runtimeVerification != null ? { runtimeVerification: body.runtimeVerification } : {}),
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
              ...(typeof body.minIterations === "number" && body.minIterations > 0
                ? { minIterations: body.minIterations }
                : {}),
              ...(body.memory ? { memory: body.memory } : {}),
              ...(body.metaTools ? { metaTools: body.metaTools } : {}),
              ...(body.fallbacks ? { fallbacks: body.fallbacks } : {}),
              ...(body.observabilityVerbosity
                ? { observabilityVerbosity: body.observabilityVerbosity }
                : {}),
              ...(body.taskContext && Object.keys(body.taskContext).length > 0
                ? { taskContext: body.taskContext }
                : {}),
              ...(body.healthCheck === true ? { healthCheck: true } : {}),
              ...(typeof body.timeout === "number" && body.timeout > 0 ? { timeout: body.timeout } : {}),
              ...(typeof body.cacheTimeout === "number" && body.cacheTimeout > 0
                ? { cacheTimeout: body.cacheTimeout }
                : {}),
              ...(typeof body.progressCheckpoint === "number" && body.progressCheckpoint > 0
                ? { progressCheckpoint: body.progressCheckpoint }
                : {}),
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
    .get("/sessions/:sessionId", ({ params, set }) => {
      const session = svc.getSession(params.sessionId);
      if (!session) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return session;
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
            ...(body.minIterations !== undefined ? { minIterations: body.minIterations } : {}),
            ...(body.memory !== undefined ? { memory: body.memory } : {}),
            ...(body.metaTools !== undefined ? { metaTools: body.metaTools } : {}),
            ...(body.fallbacks !== undefined ? { fallbacks: body.fallbacks } : {}),
            ...(body.observabilityVerbosity !== undefined
              ? { observabilityVerbosity: body.observabilityVerbosity }
              : {}),
            ...(body.taskContext !== undefined ? { taskContext: body.taskContext } : {}),
            ...(body.healthCheck !== undefined ? { healthCheck: body.healthCheck } : {}),
            ...(body.timeout !== undefined ? { timeout: body.timeout } : {}),
            ...(body.cacheTimeout !== undefined ? { cacheTimeout: body.cacheTimeout } : {}),
            ...(body.progressCheckpoint !== undefined
              ? { progressCheckpoint: body.progressCheckpoint }
              : {}),
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
        try {
          const result = await svc.chat(params.sessionId, body.message);
          return result;
        } catch (e) {
          const msg = String(e);
          set.status = msg.includes("not found") ? 404 : 500;
          return { error: msg };
        }
      },
      {
        body: t.Object({ message: t.String() }),
      },
    )
    .post(
      "/sessions/:sessionId/chat/stream",
      async ({ params, body, set }) => {
        try {
          const enc = new TextEncoder();
          const readable = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                for await (const event of svc.chatStream(params.sessionId, body.message)) {
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
          set.status = msg.includes("not found") ? 404 : 500;
          return { error: msg };
        }
      },
      {
        body: t.Object({ message: t.String() }),
      },
    );
