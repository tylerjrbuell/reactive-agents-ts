import { Elysia, t } from "elysia";
import type { ChatSessionService } from "../services/chat-session-service.js";
import { DetachedTurns } from "../services/chat-detached-turn.js";

/**
 * Decide a paused chat turn as a live turn.
 *
 * `POST /api/chat/sessions/:id/approvals/:runId/:decision/start` (`decision`: `approve` | `deny`,
 * body `{ reason? }`): records the decision and answers at once with `{ started: true, message }`
 * while the run goes on in the background as the session's turn (the same detached turn a chat
 * message streams through), so the page attaches (`GET .../chat/stream/active`) and sees the gated
 * call, its progress and its result as they happen. The reply lands in the thread when the run
 * ends, or the run holds again on its next gate. The blocking
 * `POST .../approvals/:runId/:decision` stays for API callers and the desk list.
 * 404 unknown session or paused turn, 409 a turn is running or the decision is already being
 * carried out, 422 the run could not start.
 */
export const chatApprovalStartRoute = (svc: ChatSessionService, detachedTurns: DetachedTurns = new DetachedTurns()) =>
  new Elysia({ prefix: "/api/chat" }).post(
    "/sessions/:sessionId/approvals/:runId/:decision/start",
    async ({ params, body, set }) => {
      if (!svc.getSession(params.sessionId)) {
        set.status = 404;
        return { error: "Session not found" };
      }
      if (params.decision !== "approve" && params.decision !== "deny") {
        set.status = 400;
        return { error: `Unknown decision "${params.decision}": expected approve or deny` };
      }
      if (detachedTurns.running(params.sessionId)) {
        set.status = 409;
        return { error: "A turn in this session is already running: reattach to it" };
      }
      const out = await svc.approvals.startResolve(params.sessionId, params.runId, params.decision === "approve" ? "approved" : "denied", body?.reason);
      if (!out.ok) {
        set.status = out.code === "not-found" ? 404 : out.code === "busy" ? 409 : 422;
        return { error: out.message };
      }
      detachedTurns.start(params.sessionId, out.message, out.events);
      return { started: true as const, message: out.message };
    },
    { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
  );
