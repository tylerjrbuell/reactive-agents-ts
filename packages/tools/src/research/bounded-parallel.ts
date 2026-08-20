export interface BoundedMapResult<T> {
  readonly succeeded: readonly T[];
  readonly failed: readonly { readonly input: unknown; readonly error: unknown }[];
}

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once.
 * Never throws — every item's outcome lands in `succeeded` or `failed`, so
 * one bad source in a research fan-out doesn't abort the rest. No external
 * dependency (no p-limit) — a worker-pool loop over a shared index cursor.
 */
export async function boundedMap<I, T>(
  items: readonly I[],
  concurrency: number,
  fn: (item: I) => Promise<T>,
): Promise<BoundedMapResult<T>> {
  const succeeded: T[] = [];
  const failed: { input: unknown; error: unknown }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        succeeded.push(await fn(item));
      } catch (error) {
        failed.push({ input: item, error });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { succeeded, failed };
}
