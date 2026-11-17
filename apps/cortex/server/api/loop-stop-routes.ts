import { Elysia, t } from "elysia";
import { Effect, type Layer } from "effect";
import type { DeskRunDb } from "../services/crashed-runs.js";
import { CortexRunnerService } from "../services/runner-service.js";
import type { ChatSessionService } from "../services/chat-session-service.js";
import { interruptChatTurn } from "../services/chat-run-control.js";
import { findLoopStoppedRuns, loopStoppedSummaryOf, reopenRunRow, restoreRunRow } from "../services/loop-stopped-runs.js";
import { errorText, parseResumeInput, ResumeGuard, resumeStatusOf } from "../services/loop-stop-resume.js";

/** Body of a Continue request: an optional note and an optional iteration grant. */
const ContinueBody = t.Optional(t.Object({ note: t.Optional(t.Unknown()), extraIterations: t.Optional(t.Unknown()) }));

/**
 * Pause, stop and continue an interrupted chat turn (`services/chat-resume.ts`,
 * `chat-run-control.ts`).
 *
 * - `POST /api/chat/sessions/:id/chat/stop` and `.../chat/pause`: end the streamed
 *   turn as the user; a durable run is first ended through the framework
 *   (`agent.stopRun` / `pauseRun`) so it can be continued
 *   (`{ stopped, persisted, outcome }`).
 * - `GET /api/chat/sessions/:id/resumable`: the session's resumable runs (any kind
 *   of interruption: `kind`, `status`, `stop`), newest first, leaving out the runs
 *   live in its agent (`{ runs: ResumableRunWire[] }`). Read from the durable store;
 *   never builds the session's agent.
 * - `POST /api/chat/sessions/:id/resume/:runId` `{ note?, extraIterations? }`:
 *   `agent.resumeRun`; the result lands as the session's next exchange
 *   (`{ reply, success, resumable }`). 400 bad input, 404 unknown session or run,
 *   409 busy / already continuing / not resumable (`RunNotResumableError`), 422 other.
 */
export const chatResumeRoute = (svc: ChatSessionService) =>
  new Elysia({ prefix: "/api/chat" })
    .post("/sessions/:sessionId/chat/stop", ({ params }) => interruptChatTurn(svc, params.sessionId, "stop"))
    .post("/sessions/:sessionId/chat/pause", ({ params }) => interruptChatTurn(svc, params.sessionId, "pause"))
    .get("/sessions/:sessionId/resumable", async ({ params, set }) => {
      if (!svc.getSession(params.sessionId)) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return { runs: await svc.resume.list(params.sessionId) };
    })
    .post(
      "/sessions/:sessionId/resume/:runId",
      async ({ params, body, set }) => {
        if (!svc.getSession(params.sessionId)) {
          set.status = 404;
          return { error: "Session not found" };
        }
        const input = parseResumeInput(body);
        if (!input.ok) {
          set.status = 400;
          return { error: input.error };
        }
        const out = await svc.resume.resume(params.sessionId, params.runId, input);
        if (out.ok) return out;
        set.status = resumeStatusOf(out.code);
        return { error: out.message };
      },
      { body: ContinueBody },
    );

/**
 * Continue an interrupted desk run (`services/loop-stopped-runs.ts`; the path keeps
 * its name from when only loop stops were listed).
 *
 * - `GET /api/loop-stopped-runs`: durable desk runs that ended without completing
 *   (`{ runs: LoopStoppedRunSummary[] }`: `kind`, `status`, `stop`; no launch config).
 * - `POST /api/loop-stopped-runs/:runId/resume` `{ note?, extraIterations? }`:
 *   rebuild the run's agent and call the framework's `resumeRun`; `{ agentId,
 *   runId }` (the same Cortex run). 404 when the run is not a resumable
 *   loop-stopped run, 409 while a Continue of it is already running.
 */
export const loopStoppedRunsRouter = (
  db: DeskRunDb,
  runnerLayer: Layer.Layer<CortexRunnerService>,
  home?: string,
  guard: ResumeGuard = new ResumeGuard(),
) => {
  const activeRunIds = Effect.gen(function* () {
    const runner = yield* CortexRunnerService;
    return new Set((yield* runner.getActive()).keys());
  });
  return new Elysia({ prefix: "/api/loop-stopped-runs" })
    .get("/", async () => {
      const program = Effect.gen(function* () {
        const active = yield* activeRunIds;
        const runs = yield* findLoopStoppedRuns(db, { activeRunIds: active, ...(home ? { home } : {}) });
        return { runs: runs.map(loopStoppedSummaryOf) };
      });
      return Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
    })
    .post(
      "/:runId/resume",
      async ({ params, body, set }) => {
        const input = parseResumeInput(body);
        if (!input.ok) {
          set.status = 400;
          return { error: input.error };
        }
        const slot = guard.claim(params.runId);
        if (!slot) {
          set.status = 409;
          return { error: "This run is already being continued." };
        }
        try {
          const program = Effect.gen(function* () {
            const runner = yield* CortexRunnerService;
            const active = yield* activeRunIds;
            if (active.has(params.runId)) return "running" as const;
            const [stopped] = yield* findLoopStoppedRuns(db, {
              activeRunIds: active,
              runId: params.runId,
              ...(home ? { home } : {}),
            });
            if (!stopped) return null;
            const before = reopenRunRow(db, params.runId);
            return yield* runner.resumeCrashed(stopped, input.options).pipe(
              Effect.onError(() => Effect.sync(() => (before ? restoreRunRow(db, params.runId, before) : undefined))),
            );
          });
          const out = await Effect.runPromise(program.pipe(Effect.provide(runnerLayer)));
          if (out === "running") {
            set.status = 409;
            return { error: "This run is already running." };
          }
          if (!out) {
            set.status = 404;
            return { error: "Not an interrupted run that can be continued" };
          }
          return out;
        } catch (e) {
          set.status = 500;
          return { error: errorText(e) };
        } finally {
          slot();
        }
      },
      { body: ContinueBody },
    );
};
