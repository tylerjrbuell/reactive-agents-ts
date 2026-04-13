import { Elysia, t } from "elysia";
import type { ChatSessionService } from "../services/chat-session-service.js";
import type { AgentStreamEvent } from "@reactive-agents/runtime";

const ChatSessionConfigBody = t.Object({
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
    .delete("/sessions/:sessionId", ({ params, set }) => {
      const ok = svc.deleteSession(params.sessionId);
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
      ({ params, body, set }) => {
        try {
          svc.updateSessionConfig(params.sessionId, {
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
