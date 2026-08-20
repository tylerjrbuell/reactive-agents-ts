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
  // Pre-sized slots so results land at their original index regardless of
  // completion order (network latency-dependent), then holes (failed
  // indices) are filtered out at the end. This preserves the caller's
  // ranking — e.g. searchThenFetch's "top N hits" order — instead of
  // scrambling it into completion order.
  const slots: ({ readonly ok: true; readonly value: T } | undefined)[] = new Array(items.length);
  const failed: { input: unknown; error: unknown }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      try {
        const value = await fn(item);
        slots[index] = { ok: true, value };
      } catch (error) {
        failed.push({ input: item, error });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const succeeded = slots.filter((slot): slot is { ok: true; value: T } => slot !== undefined).map(
    (slot) => slot.value,
  );

  return { succeeded, failed };
}
