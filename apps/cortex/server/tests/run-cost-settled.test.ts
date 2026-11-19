import { describe, expect, it } from "bun:test";
import { runCostSettled } from "../services/run-cost-settled.js";

describe("runCostSettled", () => {
  it("waits for result.totalCost() before resolving", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let settled = false;
    const done = runCostSettled({ totalCost: () => gate.then(() => ({ usd: 1, complete: true })) }).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    release();
    await done;
    expect(settled).toBe(true);
  });

  it("resolves at once without totalCost, and never rejects", async () => {
    await expect(runCostSettled({})).resolves.toBeUndefined();
    await expect(runCostSettled(undefined)).resolves.toBeUndefined();
    await expect(runCostSettled({ totalCost: () => Promise.reject(new Error("lost")) })).resolves.toBeUndefined();
    await expect(runCostSettled({ totalCost: () => { throw new Error("sync"); } })).resolves.toBeUndefined();
  });
});
