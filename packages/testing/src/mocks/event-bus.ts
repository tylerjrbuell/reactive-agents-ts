import { Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { CapturedEvent } from "../types.js";

/**
 * Create a mock EventBus that captures all published events.
 * Handlers registered via `on()` are stored but not executed on publish.
 */
export function createMockEventBus() {
  const events: CapturedEvent[] = [];
  const handlers: Array<{ tag?: string; handler: unknown }> = [];

  const service = {
    publish: (event: { _tag: string; [key: string]: unknown }) =>
      Effect.sync(() => {
        const { _tag, ...data } = event;
        events.push({
          _tag,
          timestamp: Date.now(),
          data: data as Record<string, unknown>,
        });
      }),

    subscribe: (handler: unknown) =>
      Effect.sync(() => {
        handlers.push({ handler });
        return () => {
          const idx = handlers.findIndex((h) => h.handler === handler);
          if (idx >= 0) handlers.splice(idx, 1);
        };
      }),

    on: (tag: string, handler: unknown) =>
      Effect.sync(() => {
        handlers.push({ tag, handler });
        return () => {
          const idx = handlers.findIndex(
            (h) => h.tag === tag && h.handler === handler,
          );
          if (idx >= 0) handlers.splice(idx, 1);
        };
      }),
  };

  const layer = Layer.succeed(EventBus, service as any);

  return {
    layer,
    service,
    events,
    captured(tag: string) {
      return events.filter((e) => e._tag === tag);
    },
    get eventCount() {
      return events.length;
    },
    reset() {
      events.length = 0;
      handlers.length = 0;
    },
  };
}
