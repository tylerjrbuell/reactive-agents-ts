import { Stream, Effect, Fiber } from "effect";
import type { AgentStreamEvent } from "./stream-types.js";
import type { AgentResult } from "./builder.js";

/** Internal helper — build SSE ReadableStream from an AsyncIterable of events. */
function _sseFromAsyncIterable(
  iterable: AsyncIterable<AgentStreamEvent>,
): Response {
  const enc = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of iterable) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (event._tag === "StreamCompleted" || event._tag === "StreamError") {
            controller.close();
            return;
          }
        }
      } catch (e) {
        try {
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ _tag: "StreamError", cause: String(e) })}\n\n`,
            ),
          );
          controller.close();
        } catch {
          // controller already closed
        }
      }
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Adapters for consuming an agent stream in different environments.
 *
 * All adapters accept either the `AsyncIterable` returned by `agent.runStream()`
 * or the raw `Stream.Stream` from the Effect layer.
 *
 * @example
 * ```typescript
 * // SSE endpoint — pass agent.runStream() directly
 * return AgentStream.toSSE(agent.runStream("prompt"));
 *
 * // ReadableStream for browser fetch / Bun.serve
 * const body = AgentStream.toReadableStream(agent.runStream("prompt"));
 *
 * // for await...of loop
 * for await (const event of agent.runStream("prompt")) { ... }
 *
 * // Collect to AgentResult (equivalent to agent.run())
 * const result = await AgentStream.collect(agent.runStream("prompt"));
 * ```
 */
export const AgentStream = {
  /**
   * Convert an agent stream to a Server-Sent Events `Response`.
   * Each event is emitted as a JSON-encoded SSE line: `data: {...}\n\n`.
   * Compatible with Bun.serve, Next.js App Router, Hono, Fastify, and any
   * standard HTTP framework that accepts a `Response` object.
   *
   * Accepts `agent.runStream()` directly — no Effect knowledge required.
   *
   * @example
   * ```typescript
   * Bun.serve({
   *   port: 3000,
   *   async fetch(req) {
   *     const agent = await ReactiveAgents.create().withProvider("anthropic").build();
   *     return AgentStream.toSSE(agent.runStream("Hello!"));
   *   },
   * });
   * ```
   */
  toSSE(
    stream: AsyncIterable<AgentStreamEvent> | Stream.Stream<AgentStreamEvent, Error>,
  ): Response {
    // AsyncIterable (the common case: agent.runStream() returns AsyncGenerator)
    if (Symbol.asyncIterator in stream) {
      return _sseFromAsyncIterable(stream as AsyncIterable<AgentStreamEvent>);
    }
    // Effect Stream (advanced / internal usage)
    const effectStream = stream as Stream.Stream<AgentStreamEvent, Error>;
    const readable = new ReadableStream({
      start(controller) {
        const fiber = Effect.runFork(
          Stream.runForEach(effectStream, (event) =>
            Effect.sync(() => {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
              );
              if (event._tag === "StreamCompleted" || event._tag === "StreamError") {
                controller.close();
              }
            }),
          ).pipe(
            Effect.catchAll((e) =>
              Effect.sync(() => {
                try {
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify({ _tag: "StreamError", cause: String(e) })}\n\n`,
                    ),
                  );
                  controller.close();
                } catch {
                  // Controller already closed
                }
              }),
            ),
          ),
        );
        return {
          cancel() {
            Effect.runFork(Fiber.interrupt(fiber));
          },
        };
      },
    });
    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },

  /**
   * Convert to a Web API `ReadableStream<AgentStreamEvent>`.
   * Compatible with browser fetch API, Node.js 18+ streams, and Bun.
   *
   * Accepts `agent.runStream()` directly.
   */
  toReadableStream(
    stream: AsyncIterable<AgentStreamEvent> | Stream.Stream<AgentStreamEvent, Error>,
  ): ReadableStream<AgentStreamEvent> {
    if (Symbol.asyncIterator in stream) {
      const iterable = stream as AsyncIterable<AgentStreamEvent>;
      return new ReadableStream({
        async start(controller) {
          try {
            for await (const event of iterable) {
              controller.enqueue(event);
              if (event._tag === "StreamCompleted" || event._tag === "StreamError") {
                controller.close();
                return;
              }
            }
          } catch {
            controller.close();
          }
        },
      });
    }
    return Stream.toReadableStream(stream as Stream.Stream<AgentStreamEvent, Error>);
  },

  /**
   * Convert to an `AsyncIterable` for `for await...of` consumption.
   * Works in any environment that supports async iterators (Node 18+, Bun, browsers).
   *
   * Note: `agent.runStream()` already returns an AsyncIterable — pass it directly
   * to a `for await...of` loop without this adapter.
   */
  toAsyncIterable(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): AsyncIterable<AgentStreamEvent> {
    return Stream.toAsyncIterable(stream);
  },

  /**
   * Collect a stream to a single `AgentResult` (equivalent to `agent.run()`).
   * Waits for `StreamCompleted` then resolves. Rejects on `StreamError`.
   *
   * Accepts `agent.runStream()` directly.
   */
  async collect(
    stream: AsyncIterable<AgentStreamEvent> | Stream.Stream<AgentStreamEvent, Error>,
  ): Promise<AgentResult> {
    if (Symbol.asyncIterator in stream) {
      const iterable = stream as AsyncIterable<AgentStreamEvent>;
      let result: AgentResult | null = null;
      let error: string | null = null;
      for await (const event of iterable) {
        if (event._tag === "StreamCompleted") {
          result = {
            output: event.output,
            success: true,
            taskId: event.taskId ?? "",
            agentId: event.agentId ?? "",
            metadata: event.metadata,
          };
        }
        if (event._tag === "StreamError") {
          error = event.cause;
        }
      }
      if (error) throw new Error(error);
      if (result) return result;
      throw new Error("Stream ended without StreamCompleted event");
    }
    return Effect.runPromise(
      Stream.runFold(
        stream as Stream.Stream<AgentStreamEvent, Error>,
        { result: null as AgentResult | null, error: null as string | null },
        (acc, event) => {
          if (event._tag === "StreamCompleted") {
            return {
              ...acc,
              result: {
                output: event.output,
                success: true,
                taskId: event.taskId ?? "",
                agentId: event.agentId ?? "",
                metadata: event.metadata,
              } as AgentResult,
            };
          }
          if (event._tag === "StreamError") {
            return { ...acc, error: event.cause };
          }
          return acc;
        },
      ).pipe(
        Effect.flatMap(({ result, error }) =>
          error
            ? Effect.fail(new Error(error))
            : result
              ? Effect.succeed(result)
              : Effect.fail(new Error("Stream ended without StreamCompleted event")),
        ),
      ),
    );
  },
};
