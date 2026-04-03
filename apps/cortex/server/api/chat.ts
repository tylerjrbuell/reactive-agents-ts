import { Elysia, t } from "elysia";
import type { ChatSessionService } from "../services/chat-session-service.js";

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
              ...(body.maxIterations != null && body.maxIterations > 0
                ? { maxIterations: body.maxIterations }
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
        body: t.Object({
          name: t.Optional(t.String()),
          provider: t.Optional(t.String()),
          model: t.Optional(t.String()),
          systemPrompt: t.Optional(t.String()),
          temperature: t.Optional(t.Number()),
          maxTokens: t.Optional(t.Number()),
          tools: t.Optional(t.Array(t.String())),
          runId: t.Optional(t.String()),
          enableTools: t.Optional(t.Boolean()),
          maxIterations: t.Optional(t.Number()),
        }),
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
    );
