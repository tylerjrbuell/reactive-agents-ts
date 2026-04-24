import { Data, Effect, Layer, Ref } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

export class RuntimeCortexReporterError extends Data.TaggedError("RuntimeCortexReporterError")<{
  readonly message: string;
}> {}

const BACKOFF_BASE_MS = 100;
const BACKOFF_MAX_MS = 2_000;
const MAX_BUFFERED_MESSAGES = 2_000;

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

/**
 * Runtime-local cortex reporter layer.
 *
 * Lives in `@reactive-agents/runtime` intentionally to ensure it depends on
 * the same EventBus service tag identity as the runtime layer graph.
 */
export const RuntimeCortexReporterLive = (cortexUrl: string) =>
  Layer.scopedDiscard(
    Effect.acquireRelease(
      Effect.gen(function* () {
      const eventBus = yield* EventBus;
      const connectedRef = yield* Ref.make(false);
      const socketRef = yield* Ref.make<WebSocket | null>(null);
      const retryAttemptRef = yield* Ref.make(0);
      const reconnectEnabledRef = yield* Ref.make(false);
      const retryTimerRef = yield* Ref.make<ReturnType<typeof setTimeout> | null>(null);
      const ingestUrlRef = yield* Ref.make(toWebSocketIngestUrl(cortexUrl));
      const bufferedMessagesRef = yield* Ref.make<string[]>([]);

      const clearRetryTimer = Effect.gen(function* () {
        const timer = yield* Ref.get(retryTimerRef);
        if (timer) {
          yield* Effect.sync(() => clearTimeout(timer));
          yield* Ref.set(retryTimerRef, null);
        }
      });

      const connectSocket = (): Effect.Effect<void, never> =>
        Ref.get(ingestUrlRef).pipe(
          Effect.flatMap((ingestUrl) =>
            Effect.sync(() => {
              const socket = new WebSocket(ingestUrl);
              socket.onopen = () => {
                Effect.runFork(
                  Effect.gen(function* () {
                    yield* Ref.set(connectedRef, true);
                    yield* Ref.set(retryAttemptRef, 0);
                    yield* clearRetryTimer;

                    // Flush any events that were emitted before the socket became OPEN.
                    const buffered = yield* Ref.get(bufferedMessagesRef);
                    if (buffered.length > 0) {
                      for (let i = 0; i < buffered.length; i++) {
                        const payload = buffered[i];
                        if (!payload) continue;
                        if (socket.readyState !== WebSocket.OPEN) break;
                        yield* Effect.sync(() => socket.send(payload)).pipe(
                          Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:76", tag: errorTag(err) })),
                        );
                      }
                      yield* Ref.set(bufferedMessagesRef, []);
                    }
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:81", tag: errorTag(err) }))),
                );
              };
              socket.onerror = () => {
                Effect.runFork(
                  Ref.set(connectedRef, false).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:86", tag: errorTag(err) }))),
                );
              };
              socket.onclose = () => {
                Effect.runFork(
                  Effect.gen(function* () {
                    yield* Ref.set(connectedRef, false);
                    const shouldReconnect = yield* Ref.get(reconnectEnabledRef);
                    if (!shouldReconnect) return;
                    const attempt = yield* Ref.updateAndGet(retryAttemptRef, (n) => n + 1);
                    const delayMs = Math.min(
                      BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1)),
                      BACKOFF_MAX_MS,
                    );
                    const timer = setTimeout(() => {
                      Effect.runFork(connectSocket());
                    }, delayMs);
                    yield* Ref.set(retryTimerRef, timer);
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:104", tag: errorTag(err) }))),
                );
              };
              Effect.runFork(Ref.set(socketRef, socket).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:107", tag: errorTag(err) }))));
            }),
          ),
          Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:110", tag: errorTag(err) })),
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

      const unsubscribe = yield* eventBus.subscribe((event) =>
        Effect.gen(function* () {
          const socket = yield* Ref.get(socketRef);
          const connected = yield* Ref.get(connectedRef);
          const payload = JSON.stringify(toIngestMessage(event));
          if (!socket || !connected || socket.readyState !== WebSocket.OPEN) {
            yield* Ref.update(bufferedMessagesRef, (buffered) => {
              const next = buffered.length >= MAX_BUFFERED_MESSAGES
                ? buffered.slice(buffered.length - MAX_BUFFERED_MESSAGES + 1)
                : buffered;
              return [...next, payload];
            });
            return;
          }
          yield* Effect.sync(() => socket.send(payload)).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:150", tag: errorTag(err) })));
        }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:151", tag: errorTag(err) }))),
      );

      yield* Ref.set(reconnectEnabledRef, true);
      yield* connectSocket();
      return {
        connectedRef,
        socketRef,
        retryTimerRef,
        reconnectEnabledRef,
        unsubscribe,
      } as const;
    }),
      ({ connectedRef, socketRef, retryTimerRef, reconnectEnabledRef, unsubscribe }) =>
        Effect.gen(function* () {
          yield* Ref.set(reconnectEnabledRef, false);
          const timer = yield* Ref.get(retryTimerRef);
          if (timer) {
            yield* Effect.sync(() => clearTimeout(timer)).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:169", tag: errorTag(err) })));
            yield* Ref.set(retryTimerRef, null);
          }
          const socket = yield* Ref.get(socketRef);
          if (socket) {
            yield* Effect.sync(() => socket.close()).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:174", tag: errorTag(err) })));
            yield* Ref.set(socketRef, null);
          }
          yield* Ref.set(connectedRef, false);
          yield* Effect.sync(() => unsubscribe()).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/cortex-reporter.ts:178", tag: errorTag(err) })));
        }),
    ),
  );
