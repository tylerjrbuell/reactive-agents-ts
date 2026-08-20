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
    expect(result.succeeded.sort()).toEqual([1, 2, 4]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].input).toBe(3);
  });
});
