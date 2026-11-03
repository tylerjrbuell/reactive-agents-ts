// Internal test support — unstable, not part of the public API.
//
// llm-provider is upstream of @reactive-agents/testing, so its own tests cannot
// import `stubFetch` from there (dependency cycle). This is the same idea in
// two lines: Bun's `typeof fetch` carries a static `preconnect` member, so a
// bare stub function needs it attached rather than a double cast.

/** The call signature of `fetch`, without the static members. */
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Wrap a fetch-shaped function so it satisfies `typeof fetch` without a cast. */
export function fetchStub(fn: FetchFn): typeof fetch {
  return Object.assign(fn, { preconnect: (): void => {} });
}
