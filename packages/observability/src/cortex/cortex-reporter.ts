import { Context, Data, Effect, Layer, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

/** Aligns with Cortex server `CORTEX_LOG` (error | warn | info | debug | off). Default: info. */
type ReporterLogFloor = "error" | "warn" | "info" | "debug" | "off";
const REP_SEVERITY: Record<Exclude<ReporterLogFloor, "off">, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function reporterLogFloor(): ReporterLogFloor {
  const raw =
    typeof process !== "undefined" && process.env && process.env.CORTEX_LOG
      ? process.env.CORTEX_LOG.trim().toLowerCase()
      : "";
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "error") return "error";
  if (raw === "warn" || raw === "warning") return "warn";
  if (raw === "debug" || raw === "trace" || raw === "verbose" || raw === "all") return "debug";
  return "info";
}

function repShouldLog(level: Exclude<ReporterLogFloor, "off">): boolean {
  const floor = reporterLogFloor();
  if (floor === "off") return false;
  return REP_SEVERITY[level] <= REP_SEVERITY[floor as Exclude<ReporterLogFloor, "off">];
}

function repLog(
  level: Exclude<ReporterLogFloor, "off">,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (!repShouldLog(level)) return;
  const suffix = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  const line = `[CortexReporter] ${message}${suffix}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export class CortexReporterError extends Data.TaggedError("CortexReporterError")<{
  readonly message: string;
}> {}

export class CortexReporter extends Context.Tag("CortexReporter")<
  CortexReporter,
  {
    readonly connect: (url: string) => Effect.Effect<void, CortexReporterError>;
    readonly disconnect: () => Effect.Effect<void, never>;
    readonly isConnected: () => Effect.Effect<boolean, never>;
  }
>() {}

const BACKOFF_BASE_MS = 100;
const BACKOFF_MAX_MS = 2_000;

type CortexIngestMessage = {
  readonly v: 1;
  readonly agentId: string;
  readonly runId: string;
  readonly sessionId?: string;
  readonly event: AgentEvent;
};

const toWebSocketIngestUrl = (cortexUrl: string): string => {
  const trimmed = cortexUrl.replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/ws/ingest`;
  return parsed.toString();
};

export const CortexReporterLive = (cortexUrl: string) =>
  Layer.effect(
    CortexReporter,
    Effect.gen(function* () {
      const eventBus = yield* EventBus;
      const connectedRef = yield* Ref.make(false);
      const socketRef = yield* Ref.make<WebSocket | null>(null);
      const retryAttemptRef = yield* Ref.make(0);
      const reconnectEnabledRef = yield* Ref.make(false);
      const retryTimerRef = yield* Ref.make<ReturnType<typeof setTimeout> | null>(null);
      const ingestUrlRef = yield* Ref.make(toWebSocketIngestUrl(cortexUrl));
      const droppedWhileDisconnectedRef = yield* Ref.make(0);

      const clearRetryTimer = Effect.gen(function* () {
        const timer = yield* Ref.get(retryTimerRef);
        if (timer) {
          yield* Effect.sync(() => clearTimeout(timer));
          yield* Ref.set(retryTimerRef, null);
        }
      });

      const connectSocket = (): Effect.Effect<void, never> =>
        Ref.get(ingestUrlRef).pipe(
          Effect.flatMap((ingestUrl) => Effect.sync(() => {
            repLog("info", "connecting ingest WebSocket", { url: ingestUrl });
            const socket = new WebSocket(ingestUrl);
          socket.onopen = () => {
            repLog("info", "ingest WebSocket open — EventBus events will forward to Cortex", {
              url: ingestUrl,
            });
            Effect.runFork(
              Ref.set(connectedRef, true).pipe(
                Effect.zipRight(Ref.set(retryAttemptRef, 0)),
                Effect.zipRight(clearRetryTimer),
                Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:111", tag: errorTag(err) })),
              ),
            );
          };
          socket.onerror = () => {
            repLog("warn", "ingest WebSocket error", { url: ingestUrl });
            Effect.runFork(
              Ref.set(connectedRef, false).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:118", tag: errorTag(err) }))),
            );
          };
          socket.onclose = () => {
            repLog("info", "ingest WebSocket closed", { url: ingestUrl });
            Effect.runFork(
              Effect.gen(function* () {
                yield* Ref.set(connectedRef, false);
                const shouldReconnect = yield* Ref.get(reconnectEnabledRef);
                if (!shouldReconnect) return;
                const attempt = yield* Ref.updateAndGet(retryAttemptRef, (n) => n + 1);
                const delayMs = Math.min(BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1)), BACKOFF_MAX_MS);
                repLog("debug", "ingest WebSocket reconnect scheduled", { attempt, delayMs, url: ingestUrl });
                const timer = setTimeout(() => {
                  Effect.runFork(connectSocket());
                }, delayMs);
                yield* Ref.set(retryTimerRef, timer);
              }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:135", tag: errorTag(err) }))),
            );
          };
          Effect.runFork(Ref.set(socketRef, socket).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:138", tag: errorTag(err) }))));
          })),
          Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:140", tag: errorTag(err) })),
        );

      const toIngestMessage = (event: AgentEvent): CortexIngestMessage => {
        const taskId =
          "taskId" in event && typeof event.taskId === "string"
            ? event.taskId
            : "unknown";
        const agentId =
          "agentId" in event && typeof event.agentId === "string"
            ? event.agentId
            : taskId;
        const sessionId =
          "sessionId" in event && typeof event.sessionId === "string"
            ? event.sessionId
            : undefined;

        return {
          v: 1,
          agentId,
          runId: taskId,
          ...(sessionId ? { sessionId } : {}),
          event,
        };
      };

      // Subscribe immediately so forwarding can be enabled regardless of connection state.
      yield* eventBus.subscribe((event) =>
        Effect.gen(function* () {
          const socket = yield* Ref.get(socketRef);
          const connected = yield* Ref.get(connectedRef);
          if (!socket || !connected || socket.readyState !== WebSocket.OPEN) {
            const n = yield* Ref.updateAndGet(droppedWhileDisconnectedRef, (c) => c + 1);
            if (n === 1) {
              yield* Effect.sync(() =>
                repLog("warn", "EventBus event dropped — ingest WebSocket not ready", {
                  eventTag: (event as { _tag?: string })._tag,
                  hasSocket: Boolean(socket),
                  connected,
                  readyState: socket?.readyState ?? null,
                }),
              );
            } else if (n % 100 === 0) {
              yield* Effect.sync(() =>
                repLog(
                  "warn",
                  `${n} EventBus events dropped while ingest WebSocket was not OPEN`,
                  { lastEventTag: (event as { _tag?: string })._tag },
                ),
              );
            }
            return;
          }
          yield* Effect.sync(() => {
            socket.send(JSON.stringify(toIngestMessage(event)));
          }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:195", tag: errorTag(err) })));
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:196", tag: errorTag(err) }))),
      );

      yield* Ref.set(reconnectEnabledRef, true);
      yield* connectSocket();

      return {
        connect: (url: string) =>
          Ref.set(reconnectEnabledRef, true).pipe(
            Effect.zipRight(Ref.set(ingestUrlRef, toWebSocketIngestUrl(url))),
            Effect.zipRight(connectSocket()),
            Effect.catchAll(() =>
              Effect.fail(
                new CortexReporterError({ message: `Failed to connect to ${url}` }),
              ),
            ),
          ),
        disconnect: () =>
          Effect.gen(function* () {
            yield* Ref.set(reconnectEnabledRef, false);
            yield* clearRetryTimer;
            const socket = yield* Ref.get(socketRef);
            if (socket) {
              yield* Effect.sync(() => socket.close()).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "observability/src/cortex/cortex-reporter.ts:219", tag: errorTag(err) })));
            }
            yield* Ref.set(socketRef, null);
            yield* Ref.set(connectedRef, false);
          }),
        isConnected: () => Ref.get(connectedRef),
      };
    }),
  );
