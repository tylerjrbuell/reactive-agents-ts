import { Stream, Effect, Fiber } from "effect";
import type { AgentStreamEvent } from "./stream-types.js";
import type { AgentResult } from "./builder.js";

/**
 * Adapters for consuming an agent stream in different environments.
 *
 * @example
 * ```typescript
 * // Next.js / Hono SSE
 * return AgentStream.toSSE(agent.runStream("prompt"));
 *
 * // Browser fetch / ReadableStream
 * const body = AgentStream.toReadableStream(agent.runStream("prompt"));
 *
 * // for await...of loop
 * for await (const event of AgentStream.toAsyncIterable(stream)) { ... }
 *
 * // Collect to AgentResult (equivalent to agent.run())
 * const result = await AgentStream.collect(stream);
 * ```
 */
export const AgentStream = {
  /**
   * Convert an Effect stream to a Server-Sent Events Response.
   * Each event is emitted as a JSON-encoded SSE line: `data: {...}\n\n`.
   * Compatible with Next.js App Router, Hono, Fastify, and any standard HTTP framework.
   * The forked fiber is captured and interrupted when the HTTP client disconnects.
   */
  toSSE(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): Response {
    const readable = new ReadableStream({
      start(controller) {
        const fiber = Effect.runFork(
          Stream.runForEach(stream, (event) =>
            Effect.sync(() => {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
              );
              if (
                event._tag === "StreamCompleted" ||
                event._tag === "StreamError"
              ) {
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
   * Convert to a Web API ReadableStream of AgentStreamEvent objects.
   * Compatible with browser fetch API and Node.js 18+ streams.
   */
  toReadableStream(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): ReadableStream<AgentStreamEvent> {
    return Stream.toReadableStream(stream);
  },

  /**
   * Convert to an AsyncIterable for `for await...of` consumption.
   * Works in any environment that supports async iterators (Node 18+, Bun, browsers).
   */
  toAsyncIterable(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): AsyncIterable<AgentStreamEvent> {
    return Stream.toAsyncIterable(stream);
  },

  /**
   * Collect a stream to a single AgentResult (equivalent to agent.run()).
   * Waits for StreamCompleted then resolves. Rejects via Effect error channel
   * if StreamError is received — no imperative throw inside the accumulator.
   */
  collect(
    stream: Stream.Stream<AgentStreamEvent, Error>,
  ): Promise<AgentResult> {
    return Effect.runPromise(
      Stream.runFold(
        stream,
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
              : Effect.fail(
                  new Error("Stream ended without StreamCompleted event"),
                ),
        ),
      ),
    );
  },
};
