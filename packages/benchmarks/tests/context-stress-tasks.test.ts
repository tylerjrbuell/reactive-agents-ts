import { describe, it, expect } from "bun:test";
import { CONTEXT_STRESS_TASKS } from "../src/tasks/context-stress.js";

describe("context-stress tasks", () => {
  it("defines the failure-mode set with success criteria + real-world tier", () => {
    const ids = CONTEXT_STRESS_TASKS.map((t) => t.id);
    expect(ids).toContain("cs-overflow-summarize");
    expect(ids).toContain("cs-overflow-transcribe");
    expect(ids).toContain("cs-recall-temptation");
    expect(ids).toContain("cs-dishonest-bait");
    for (const t of CONTEXT_STRESS_TASKS) {
      expect(t.successCriteria).toBeDefined();
      expect(t.tier).toBe("real-world");
    }
  });
  it("overflow tasks ship a large fixture to stress the window", () => {
    const t = CONTEXT_STRESS_TASKS.find((x) => x.id === "cs-overflow-transcribe")!;
    expect((t.fixtures?.[0]?.content.length ?? 0)).toBeGreaterThan(2000);
  });
});
