import { describe, it, expect } from "bun:test";
import { contextStressSession } from "../src/sessions/context-stress.js";
import { resolveTasks } from "../src/session.js";
import { BENCHMARK_TASKS } from "../src/task-registry.js";
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js";
import { CONTEXT_STRESS_TASKS } from "../src/tasks/context-stress.js";

describe("context-stress session", () => {
  it("pairs project() vs legacy across tiers on the failure-mode tasks", () => {
    const armIds = contextStressSession.harnessVariants.map((v) => v.id).sort();
    expect(armIds).toEqual(["ra-full", "ra-full-assembly-off"]);
    expect(contextStressSession.models.some((m) => m.contextTier === "local")).toBe(true);
    expect(contextStressSession.runs).toBeGreaterThanOrEqual(3);
  });
  it("resolves the four context-stress tasks", () => {
    const all = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS, ...CONTEXT_STRESS_TASKS];
    const resolved = resolveTasks(contextStressSession, all);
    expect(resolved.length).toBe(4);
    expect(resolved.map((t) => t.id).sort()).toEqual([
      "cs-dishonest-bait",
      "cs-overflow-summarize",
      "cs-overflow-transcribe",
      "cs-recall-temptation",
    ]);
  });
});
