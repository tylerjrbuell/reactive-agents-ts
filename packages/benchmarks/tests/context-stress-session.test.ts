import { describe, it, expect } from "bun:test";
import { contextStressSession } from "../src/sessions/context-stress.js";
import { resolveTasks } from "../src/session.js";
import { BENCHMARK_TASKS } from "../src/task-registry.js";
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js";
import { CONTEXT_STRESS_TASKS } from "../src/tasks/context-stress.js";

describe("context-stress session", () => {
  it("runs canonical project() arm cross-tier on the failure-mode tasks", () => {
    // Sprint-1 A2 (2026-06-02): the legacy `ra-full-assembly-off` arm was
    // removed when RA_ASSEMBLY flag + curate() else-branch were deleted.
    // Canonical project() is the sole assembler; session is single-arm.
    const armIds = contextStressSession.harnessVariants.map((v) => v.id);
    expect(armIds).toEqual(["ra-full"]);
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
