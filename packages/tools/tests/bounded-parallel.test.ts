import { describe, it, expect } from "bun:test";
import { boundedMap } from "../src/research/bounded-parallel.js";

describe("boundedMap", () => {
  it("never runs more than `concurrency` tasks at once", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await boundedMap(items, 3, async (i) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
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
    // Item 0 takes the longest, item 4 the shortest — completion order is
    // therefore the REVERSE of input order. succeeded must still come back
    // in original input order (0,1,2,3,4), not completion order.
    const items = [0, 1, 2, 3, 4];
    const delays = [50, 40, 30, 20, 10];
    const result = await boundedMap(items, 5, async (i) => {
      await new Promise((r) => setTimeout(r, delays[i]));
      return `item-${i}`;
    });
    expect(result.succeeded).toEqual(["item-0", "item-1", "item-2", "item-3", "item-4"]);
  });

  it("preserves order of surviving items when some fail out of order", async () => {
    // Item 3 fails fast; the rest succeed with staggered delays so
    // completion order differs from input order.
    const items = [0, 1, 2, 3, 4];
    const delays = [30, 20, 10, 0, 5];
    const result = await boundedMap(items, 5, async (i) => {
      await new Promise((r) => setTimeout(r, delays[i]));
      if (i === 3) throw new Error("bad item 3");
      return `item-${i}`;
    });
    expect(result.succeeded).toEqual(["item-0", "item-1", "item-2", "item-4"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].input).toBe(3);
  });
});
