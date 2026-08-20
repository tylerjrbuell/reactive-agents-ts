import { boundedMap } from "./bounded-parallel.js";

export interface SearchThenFetchOptions<S, T> {
  readonly search: (query: string) => Promise<readonly S[]>;
  readonly fetchOne: (result: S) => Promise<T>;
  readonly maxResults?: number;
  readonly concurrency?: number;
}

export interface SearchThenFetchResult<T> {
  readonly items: readonly T[];
  readonly errors: readonly { readonly input: unknown; readonly error: unknown }[];
}

/**
 * The "search, then fetch the top N hits in parallel" pattern every
 * research-style custom tool (Halopedia lore lookups, doc search, etc.)
 * currently hand-rolls. `search` runs once; `fetchOne` runs at most
 * `maxResults` times (default 5), bounded to `concurrency` in flight
 * (default 3) via `boundedMap`.
 */
export async function searchThenFetch<S, T>(
  query: string,
  options: SearchThenFetchOptions<S, T>,
): Promise<SearchThenFetchResult<T>> {
  const { search, fetchOne, maxResults = 5, concurrency = 3 } = options;
  const results = await search(query);
  const bounded = results.slice(0, maxResults);
  const { succeeded, failed } = await boundedMap(bounded, concurrency, fetchOne);
  return { items: succeeded, errors: failed };
}
