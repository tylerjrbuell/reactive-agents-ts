export interface ResolveThenRetrieveOptions<R, T> {
  readonly resolve: (name: string) => Promise<R | null>;
  readonly retrieve: (resolved: R) => Promise<T>;
}

/**
 * The "resolve a fuzzy name to a canonical ID, then retrieve the full
 * record" pattern (e.g. "Master Chief" -> page ID -> full article). Returns
 * `null` when `resolve` finds nothing — a real "not found" is not an error
 * and `retrieve` is never called in that case.
 */
export async function resolveThenRetrieve<R, T>(
  name: string,
  options: ResolveThenRetrieveOptions<R, T>,
): Promise<T | null> {
  const resolved = await options.resolve(name);
  if (resolved === null) return null;
  return options.retrieve(resolved);
}
