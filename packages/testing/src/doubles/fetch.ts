/**
 * Internal test support — unstable, not part of the public API.
 *
 * Typed `fetch` test double.
 *
 * Bun's `typeof fetch` carries a static `preconnect` member, so a bare stub
 * function does not structurally satisfy it and tests used to widen it with a
 * double cast. `stubFetch` builds a conforming object instead: a real function
 * with `preconnect` attached, so no cast is needed anywhere.
 */

/** Handler that answers one request. Receives a normalized `Request`. */
export type FetchHandler = (input: Request) => Response | Promise<Response>;

/**
 * Build a `fetch` replacement that routes every call through `handler`.
 *
 * Call arguments are normalized to a `Request` (`new Request(input, init)`), so
 * the handler sees the method, headers, URL and body exactly as `fetch` would.
 * Assign the result to `globalThis.fetch` or inject it where a fetch is taken.
 *
 * @example
 * ```ts
 * globalThis.fetch = stubFetch(() => new Response(JSON.stringify({ ok: true })));
 * ```
 */
export function stubFetch(handler: FetchHandler): typeof globalThis.fetch {
  const stub = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => handler(new Request(input, init));
  return Object.assign(stub, {
    preconnect: (_url: string | URL): void => undefined,
  });
}
