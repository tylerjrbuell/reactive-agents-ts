/**
 * Internal test support — unstable, not part of the public API.
 *
 * Real `Response` builders for fetch-backed tests.
 *
 * Tests used to hand-build partial `Response`-shaped literals and widen them
 * with a double cast. A real `new Response(...)` is cheap and complete, so these
 * helpers cover the common shapes instead.
 */

/** A JSON `Response` (`content-type: application/json`). Default status 200. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

/** A plain-text `Response`. Default status 200. */
export function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

/**
 * A server-sent-events `Response` whose body streams `events` as `data:` lines,
 * one chunk per event, then closes. Strings are sent verbatim; other values are
 * JSON-encoded.
 */
export function sseResponse(events: readonly unknown[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const data = typeof event === "string" ? event : JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    },
  });
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/event-stream");
  return new Response(body, { status: 200, ...init, headers });
}
