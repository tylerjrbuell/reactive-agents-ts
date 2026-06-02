import { describe, it, expect } from "bun:test";
import { passKFromManifest, meanFaithfulness, type ManifestRow } from "../compare-arms.js";

const row = (success: boolean, faithfulness: number): ManifestRow => ({
  tier: "local",
  task: "t",
  run: 0,
  faithfulness,
  result: { success, taskId: `x${Math.random()}` },
});

describe("passKFromManifest", () => {
  it("pass^k = 1 only when every run in the cohort claimed success", () => {
    expect(passKFromManifest([row(true, 1), row(true, 1)])).toBe(1);
  });
  it("pass^k = 0 when any run failed", () => {
    expect(passKFromManifest([row(true, 1), row(false, 1)])).toBe(0);
  });
});

describe("meanFaithfulness", () => {
  it("averages the per-cell faithfulness", () => {
    expect(meanFaithfulness([row(true, 1), row(true, 0.5)])).toBe(0.75);
  });
  it("is 0 when no rows carry faithfulness", () => {
    expect(meanFaithfulness([{ tier: "local", task: "t", run: 0, result: { success: true } }])).toBe(0);
  });
});
