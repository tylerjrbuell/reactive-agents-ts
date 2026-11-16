import { Elysia, t } from "elysia";
import type { ChatSessionService } from "../services/chat-session-service.js";

/** Session mode from a request body; `null` when absent or not `plan`/`execute`. */
export function parseChatMode(raw: string | undefined): "execute" | "plan" | null {
  return raw === "execute" || raw === "plan" ? raw : null;
}

/**
 * `PUT /api/chat/sessions/:id/mode`: switch the chat session between `plan` (reasoning only, no
 * tools) and `execute`. Stored with the session, so it survives a reload.
 */
export const chatModeRoute = (svc: ChatSessionService) =>
  new Elysia({ prefix: "/api/chat" }).put(
    "/sessions/:sessionId/mode",
    async ({ params, body, set }) => {
      const mode = parseChatMode(body.mode);
      if (mode === null) {
        set.status = 400;
        return { error: `Invalid mode "${body.mode}": expected "execute" or "plan"` };
      }
      try {
        await svc.setMode(params.sessionId, mode);
        return { mode };
      } catch (e) {
        const notFound = typeof e === "object" && e !== null && "_tag" in e && e._tag === "CortexNotFoundError";
        set.status = notFound ? 404 : 500;
        return { error: notFound ? `Chat session ${params.sessionId} not found` : String(e) };
      }
    },
    { body: t.Object({ mode: t.String() }) },
  );
