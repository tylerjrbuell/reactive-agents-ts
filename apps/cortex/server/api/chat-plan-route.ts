import { Elysia, t } from "elysia";
import { cleanPlanSteps, type ChatSessionPlans } from "../services/chat-session-plan.js";

/** The slice of the chat service the plan routes use (`ChatSessionService.plans`, `getSession`). */
export interface ChatPlanHost {
  readonly plans: Pick<ChatSessionPlans, "read" | "write">;
  getSession(sessionId: string): unknown;
}

const isNotFound = (e: unknown): boolean => typeof e === "object" && e !== null && "_tag" in e && e._tag === "CortexNotFoundError";
// ChatSessionBusyError and its approval-pending subclass set `name` (a turn is in flight: 409).
const isBusy = (e: unknown): boolean => typeof e === "object" && e !== null && "name" in e && (e.name === "ChatSessionBusyError" || e.name === "ChatApprovalPendingError");
const messageOf = (e: unknown): string => (typeof e === "object" && e !== null && "message" in e && typeof e.message === "string" ? e.message : String(e));

/**
 * The session's plan (the framework `Plan` over the conversation's to-do list), persisted with
 * the session.
 * - `GET /api/chat/sessions/:id/plan` -> `{ plan }` (`null` while there is none).
 * - `PUT /api/chat/sessions/:id/plan` `{ steps }` -> `{ plan }`: a user edit through
 *   `session.setPlan`; the next turn, in any mode, seeds from it. 409 while a turn is running.
 */
export const chatPlanRoute = (svc: ChatPlanHost) =>
  new Elysia({ prefix: "/api/chat" })
    .get("/sessions/:sessionId/plan", ({ params, set }) => {
      if (!svc.getSession(params.sessionId)) {
        set.status = 404;
        return { error: `Chat session ${params.sessionId} not found` };
      }
      return { plan: svc.plans.read(params.sessionId) };
    })
    .put(
      "/sessions/:sessionId/plan",
      async ({ params, body, set }) => {
        const clean = cleanPlanSteps(body.steps);
        if (!clean.ok) {
          set.status = 400;
          return { error: clean.error };
        }
        try {
          return { plan: await svc.plans.write(params.sessionId, clean.steps) };
        } catch (e) {
          set.status = isBusy(e) ? 409 : isNotFound(e) ? 404 : 500;
          return { error: isNotFound(e) ? `Chat session ${params.sessionId} not found` : messageOf(e) };
        }
      },
      {
        body: t.Object({
          steps: t.Array(
            t.Object({
              id: t.Optional(t.String()),
              title: t.String(),
              tool: t.Optional(t.String()),
              status: t.Optional(t.Union([t.Literal("pending"), t.Literal("in-progress"), t.Literal("done"), t.Literal("skipped")])),
            }),
          ),
        }),
      },
    );
