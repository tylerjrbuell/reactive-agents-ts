/**
 * /api/voice/local — control of the local speech server (Speaches) that `speech-supervisor.ts` runs in docker.
 *
 * - GET  /status        the supervisor's state, after a cheap health check; with docker allowed and the
 *                        server up, the model cache's free space (`docker exec ... df`, at most once a minute)
 * - POST /ensure        Retry: run again now; answers at once with the state, the work continues
 * - POST /keep-running  { enabled } the opt-in; off stops the Cortex container (answers after the stop)
 * - POST /start         start the server now (keep-running or not); answers at once, the work continues
 * - POST /stop          stop the Cortex container and switch keep-running off
 * - POST /config        { port?, device? } port and hardware; re-creates the container when it ran
 *
 * Every POST answers 403 when `allowDocker` is false (reachable from other machines without a
 * token), on top of the request guard. Nothing here takes a container or image name from input.
 */
import { Elysia, t } from "elysia";
import type { SpeechAction, SpeechSupervisor } from "../services/voice/speech-supervisor.js";

/** What the routes need. */
export interface VoiceLocalRouterDeps {
  readonly supervisor: SpeechSupervisor;
  /** Whether this Cortex may run docker (loopback bind, or an access token). */
  readonly allowDocker: boolean;
}

const DOCKER_REFUSAL = { error: "Cortex is reachable from other machines without an access token, so it will not run docker. Set CORTEX_TOKEN." } as const;

/** Build the router. */
export function voiceLocalRouter(deps: VoiceLocalRouterDeps) {
  const sup = deps.supervisor;
  /** 400 with the refusal sentence, or the status. */
  const answer = (r: SpeechAction, set: { status?: number | string }) => {
    if (r.ok) return r.status;
    set.status = 400;
    return { error: r.error };
  };
  return new Elysia({ prefix: "/api/voice/local" })
    // Free space for the model cache is measured with docker, so only where this Cortex may run docker.
    .get("/status", () => sup.probe({ measureDisk: deps.allowDocker }))
    .post("/ensure", ({ set }) => {
      if (!deps.allowDocker) {
        set.status = 403;
        return DOCKER_REFUSAL;
      }
      void sup.retry().catch(() => undefined);
      return sup.status();
    })
    .post(
      "/keep-running",
      async ({ body, set }) => {
        if (!deps.allowDocker) {
          set.status = 403;
          return DOCKER_REFUSAL;
        }
        return answer(await sup.setKeepRunning(body.enabled), set);
      },
      { body: t.Object({ enabled: t.Boolean() }) },
    )
    .post("/start", ({ set }) => {
      if (!deps.allowDocker) {
        set.status = 403;
        return DOCKER_REFUSAL;
      }
      return answer(sup.startServer(), set);
    })
    .post("/stop", async ({ set }) => {
      if (!deps.allowDocker) {
        set.status = 403;
        return DOCKER_REFUSAL;
      }
      return answer(await sup.stopServer(), set);
    })
    .post(
      "/config",
      async ({ body, set }) => {
        if (!deps.allowDocker) {
          set.status = 403;
          return DOCKER_REFUSAL;
        }
        return answer(await sup.configure(body), set);
      },
      {
        body: t.Object({
          port: t.Optional(t.Integer({ minimum: 1024, maximum: 65535 })),
          device: t.Optional(t.Union([t.Literal("auto"), t.Literal("cpu"), t.Literal("cuda")])),
        }),
      },
    );
}
