// Internal test support — unstable, not part of the public API.
//
// tools is upstream of @reactive-agents/testing, so its tests cannot import
// `stubFetch` from there (dependency cycle). Bun's `typeof fetch` carries a
// static `preconnect` member, so a bare stub function needs it attached rather
// than a double cast.
import { mock } from "bun:test";

/** The call signature of `fetch`, without the static members. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Wrap a fetch-shaped function so it satisfies `typeof fetch` without a cast. */
export function fetchStub(fn: FetchFn): typeof fetch {
  return Object.assign(fn, { preconnect: (): void => {} });
}

/** A `bun:test` mock wrapped as a `typeof fetch` (call counts via the returned fn's mock API are not exposed). */
export function mockFetch(fn: FetchFn): typeof fetch {
  return fetchStub(mock(fn));
}
