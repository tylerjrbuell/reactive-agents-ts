import { Context, Data, Effect, Layer, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";

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
            const socket = new WebSocket(ingestUrl);
          socket.onopen = () => {
            Effect.runFork(
              Ref.set(connectedRef, true).pipe(
                Effect.zipRight(Ref.set(retryAttemptRef, 0)),
                Effect.zipRight(clearRetryTimer),
                Effect.catchAll(() => Effect.void),
              ),
            );
          };
          socket.onerror = () => {
            Effect.runFork(
              Ref.set(connectedRef, false).pipe(Effect.catchAll(() => Effect.void)),
            );
          };
          socket.onclose = () => {
            Effect.runFork(
              Effect.gen(function* () {
                yield* Ref.set(connectedRef, false);
                const shouldReconnect = yield* Ref.get(reconnectEnabledRef);
                if (!shouldReconnect) return;
                const attempt = yield* Ref.updateAndGet(retryAttemptRef, (n) => n + 1);
                const delayMs = Math.min(BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1)), BACKOFF_MAX_MS);
                const timer = setTimeout(() => {
                  Effect.runFork(connectSocket());
                }, delayMs);
                yield* Ref.set(retryTimerRef, timer);
              }).pipe(Effect.catchAll(() => Effect.void)),
            );
          };
          Effect.runFork(Ref.set(socketRef, socket).pipe(Effect.catchAll(() => Effect.void)));
          })),
          Effect.catchAll(() => Effect.void),
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
          if (!socket || !connected || socket.readyState !== WebSocket.OPEN) return;
          yield* Effect.sync(() => {
            socket.send(JSON.stringify(toIngestMessage(event)));
          }).pipe(Effect.catchAll(() => Effect.void));
        }).pipe(Effect.catchAll(() => Effect.void)),
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
              yield* Effect.sync(() => socket.close()).pipe(Effect.catchAll(() => Effect.void));
            }
            yield* Ref.set(socketRef, null);
            yield* Ref.set(connectedRef, false);
          }),
        isConnected: () => Ref.get(connectedRef),
      };
    }),
  );
