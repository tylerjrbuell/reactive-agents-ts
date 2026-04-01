import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import { CortexReporter, CortexReporterLive } from "../src/cortex/cortex-reporter.js";

describe("CortexReporter", () => {
  const originalWebSocket = globalThis.WebSocket;
  const prevCortexLog = process.env.CORTEX_LOG;

  beforeAll(() => {
    process.env.CORTEX_LOG = "error";
  });

  afterAll(() => {
    if (prevCortexLog === undefined) delete process.env.CORTEX_LOG;
    else process.env.CORTEX_LOG = prevCortexLog;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("forwards EventBus events to cortex websocket ingest endpoint", async () => {
    const sentPayloads: string[] = [];
    const openedUrls: string[] = [];

    class FakeWebSocket {
      static OPEN = 1;
      readyState = FakeWebSocket.OPEN;
      onopen: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor(url: string) {
        openedUrls.push(url);
        queueMicrotask(() => this.onopen?.({}));
      }

      send(payload: string) {
        sentPayloads.push(payload);
      }

      close() {
        this.readyState = 3;
        this.onclose?.({});
      }
    }

    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const listeners: Array<(event: unknown) => Effect.Effect<void, never>> = [];
    const mockEventBus = Layer.succeed(EventBus, {
      publish: (event: unknown) =>
        Effect.forEach(listeners, (listener) => listener(event)).pipe(Effect.asVoid),
      subscribe: (listener: (event: unknown) => Effect.Effect<void, never>) =>
        Effect.sync(() => {
          listeners.push(listener);
          return () => {
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        }),
      on: () => Effect.succeed(() => {}),
    } as any);

    const layer = CortexReporterLive("http://localhost:4321").pipe(Layer.provide(mockEventBus));

    const program = Effect.gen(function* () {
      const reporter = yield* CortexReporter;
      yield* Effect.sleep("10 millis");
      expect(yield* reporter.isConnected()).toBe(true);
      const event = {
        _tag: "AgentStarted",
        taskId: "task-forward-1",
        agentId: "agent-forward-1",
        timestamp: Date.now(),
      } as const;
      yield* Effect.forEach(listeners, (listener) => listener(event));
      yield* Effect.sleep("10 millis");
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(openedUrls[0]).toBe("ws://localhost:4321/ws/ingest");
    expect(sentPayloads.length).toBe(1);
    expect(sentPayloads[0]).toContain('"taskId":"task-forward-1"');
  });

  it("stays non-fatal and disconnected when websocket is offline", async () => {
    class FailingWebSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      constructor(_url: string) {
        queueMicrotask(() => this.onerror?.({}));
        queueMicrotask(() => this.onclose?.({}));
      }
      send(_payload: string) {}
      close() {}
    }

    globalThis.WebSocket = FailingWebSocket as unknown as typeof WebSocket;

    const listeners: Array<(event: unknown) => Effect.Effect<void, never>> = [];
    const mockEventBus = Layer.succeed(EventBus, {
      publish: (event: unknown) =>
        Effect.forEach(listeners, (listener) => listener(event)).pipe(Effect.asVoid),
      subscribe: () => {
        return Effect.sync(() => {
          listeners.push(() => Effect.void);
          return () => {};
        });
      },
      on: () => Effect.succeed(() => {}),
    } as any);

    const layer = CortexReporterLive("http://localhost:4321").pipe(Layer.provide(mockEventBus));

    await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* CortexReporter;
        yield* Effect.sleep("20 millis");
        expect(yield* reporter.isConnected()).toBe(false);
        const event = {
          _tag: "AgentStarted",
          taskId: "task-offline-1",
          agentId: "agent-offline-1",
          timestamp: Date.now(),
        } as const;
        yield* Effect.forEach(listeners, (listener) => listener(event));
      }).pipe(Effect.provide(layer)),
    );
  });

  it("retries with backoff and supports endpoint construction from trailing slash URLs", async () => {
    const openedUrls: string[] = [];
    let attempts = 0;

    class RetrySocket {
      static OPEN = 1;
      readyState = 0;
      onopen: ((event: unknown) => void) | null = null;
      onclose: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor(url: string) {
        attempts += 1;
        openedUrls.push(url);
        if (attempts < 3) {
          queueMicrotask(() => this.onerror?.({}));
          queueMicrotask(() => this.onclose?.({}));
          return;
        }
        this.readyState = RetrySocket.OPEN;
        queueMicrotask(() => this.onopen?.({}));
      }

      send(_payload: string) {}
      close() {}
    }

    globalThis.WebSocket = RetrySocket as unknown as typeof WebSocket;

    const mockEventBus = Layer.succeed(EventBus, {
      publish: () => Effect.void,
      subscribe: () => Effect.succeed(() => {}),
      on: () => Effect.succeed(() => {}),
    } as any);

    const layer = CortexReporterLive("http://localhost:4321/").pipe(Layer.provide(mockEventBus));

    await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* CortexReporter;
        yield* Effect.sleep("350 millis");
        expect(yield* reporter.isConnected()).toBe(true);
      }).pipe(Effect.provide(layer)),
    );

    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(openedUrls[0]).toBe("ws://localhost:4321/ws/ingest");
  });
});
