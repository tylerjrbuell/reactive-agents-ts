import { Elysia, t } from "elysia";
import { cleanPlanSteps, type ChatSessionPlans } from "../services/chat-session-plan.js";
import { exportPlan, importPlan, isPlanExportFormat, PLAN_IMPORT_MAX_CHARS } from "../services/chat-plan-portable.js";

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
 * - `PUT /api/chat/sessions/:id/plan` `{ steps, goal? }` -> `{ plan }`: a user edit through
 *   `session.setPlan`; the next turn, in any mode, seeds from it. 409 while a turn is running.
 * - `GET /api/chat/sessions/:id/plan/export?format=markdown|html|json` -> the saved plan as a
 *   document in the framework's portable format (`Content-Disposition` names the file); 404 when
 *   the session has no plan.
 * - `POST /api/chat/sessions/:id/plan/parse` `{ text }` -> `{ plan }` or 422 `{ error, reason }`:
 *   reads Markdown or a JSON envelope without changing anything; the client applies the result
 *   through the PUT above.
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
    .get("/sessions/:sessionId/plan/export", ({ params, query, set }) => {
      const format: string = query.format ?? "markdown";
      if (!isPlanExportFormat(format)) {
        set.status = 400;
        return { error: `Unknown format "${format}": use markdown, html or json` };
      }
      if (!svc.getSession(params.sessionId)) {
        set.status = 404;
        return { error: `Chat session ${params.sessionId} not found` };
      }
      const plan = svc.plans.read(params.sessionId);
      if (plan === null) {
        set.status = 404;
        return { error: "This session has no plan yet" };
      }
      const out = exportPlan(plan, format, params.sessionId);
      return new Response(out.body, { headers: { "content-type": out.mime, "content-disposition": `attachment; filename="${out.filename}"` } });
    }, { query: t.Object({ format: t.Optional(t.String()) }) })
    .post(
      "/sessions/:sessionId/plan/parse",
      ({ params, body, set }) => {
        if (!svc.getSession(params.sessionId)) {
          set.status = 404;
          return { error: `Chat session ${params.sessionId} not found` };
        }
        if (body.text.length > PLAN_IMPORT_MAX_CHARS) {
          set.status = 413;
          return { error: "That plan is too large to import", reason: "invalid-shape" };
        }
        const res = importPlan(body.text);
        if (!res.ok) {
          set.status = 422;
          return { error: res.message, reason: res.reason };
        }
        return { plan: res.plan };
      },
      { body: t.Object({ text: t.String() }) },
    )
    .put(
      "/sessions/:sessionId/plan",
      async ({ params, body, set }) => {
        const clean = cleanPlanSteps(body.steps);
        if (!clean.ok) {
          set.status = 400;
          return { error: clean.error };
        }
        try {
          return { plan: await svc.plans.write(params.sessionId, clean.steps, body.goal?.trim()) };
        } catch (e) {
          set.status = isBusy(e) ? 409 : isNotFound(e) ? 404 : 500;
          return { error: isNotFound(e) ? `Chat session ${params.sessionId} not found` : messageOf(e) };
        }
      },
      {
        body: t.Object({
          goal: t.Optional(t.String()),
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
