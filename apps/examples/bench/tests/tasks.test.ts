import { describe, it, expect } from "bun:test";
import { BENCH_TASKS, getTask } from "../tasks.js";

describe("bench task set", () => {
  it("covers the five failure modes with stable ids", () => {
    const modes = new Set(BENCH_TASKS.map((t) => t.failureMode));
    expect(modes).toEqual(
      new Set([
        "overflow-summarize",
        "overflow-transcribe",
        "multi-result-accumulation",
        "recall-temptation",
        "dishonest-success-bait",
      ]),
    );
  });
  it("every task declares tools, expectedSections, and a deterministic prompt", () => {
    for (const t of BENCH_TASKS) {
      expect(t.tools.length).toBeGreaterThan(0);
      expect(t.expectedSections.length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeGreaterThan(20);
    }
  });
  it("getTask resolves by id and throws on unknown", () => {
    expect(getTask(BENCH_TASKS[0]!.id).id).toBe(BENCH_TASKS[0]!.id);
    expect(() => getTask("nope")).toThrow();
  });
});
