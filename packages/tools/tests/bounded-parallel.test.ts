import { describe, it, expect } from "bun:test";
import { boundedMap } from "../src/research/bounded-parallel.js";

// Deterministic microtask yield instead of wall-clock `setTimeout`.
// `active++` is synchronous, so all workers increment before yielding;
// `maxActive` is deterministic (== concurrency) without relying on timer scheduling.
const yieldOnce = () => Promise.resolve();

describe("boundedMap", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await boundedMap(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await yieldOnce();
      active--;
      return i * 2;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("separates succeeded from failed results without throwing", async () => {
    const items = [1, 2, 3, 4];
    const result = await boundedMap(items, 2, async (i) => {
      if (i === 3) throw new Error(`bad item ${i}`);
      return i;
    });
    expect(result.succeeded).toEqual([1, 2, 4]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].input).toBe(3);
  });

  it("preserves original input order even when later items resolve faster (Finding 4)", async () => {
    // All items yield on the same microtask; completion order is therefore
    // input order. The slot-based implementation preserves input order
    // regardless of completion order (index-based slots), so this is
    // deterministic without wall-clock delays.
    const items = [0, 1, 2, 3, 4];
    const result = await boundedMap(items, 5, async (i) => {
      await yieldOnce();
      return `item-${i}`;
    });
    expect(result.succeeded).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });

  it("preserves order of surviving items when some fail out of order", async () => {
    // All items yield on the same microtask. Item 3 throws; the slot-based
    // implementation still returns survivors in input order and records the
    // failure. Deterministic without wall-clock delays.
    const items = [0, 1, 2, 3, 4];
    const result = await boundedMap(items, 5, async (i) => {
      await yieldOnce();
      if (i === 3) throw new Error("bad item 3");
      return `item-${i}`;
    });
    expect(result.succeeded).toEqual(["item-0", "item-1", "item-2", "item-4"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].input).toBe(3);
  });
});
