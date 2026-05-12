// File: tests/m3-ablation-session.test.ts
//
// Config-shape test for the M3 verifier ablation. Validates that the new
// `ra-full-noop-verifier` variant exists in the ABLATION_VARIANTS catalog and
// that the m3-ablation session enumerates exactly 60 (model, variant, task,
// run) dispatch tuples — 3 models × 2 variants × 10 tasks × n=1. The test
// derives the count from the session config without executing any LLM calls.

import { describe, it, expect } from "bun:test";
import { getVariant, resolveTasks } from "../src/session.js";
import { m3AblationSession } from "../src/sessions/m3-ablation.js";
import { BENCHMARK_TASKS } from "../src/task-registry.js";
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js";

const ALL_TASKS = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS];

describe("M3 ablation — config shape", () => {
  it("ra-full-noop-verifier variant exists with verifier: 'noop'", () => {
    const v = getVariant("ra-full-noop-verifier");
    expect(v.type).toBe("internal");
    if (v.type !== "internal") throw new Error("type narrow");
    expect(v.config.verifier).toBe("noop");
    expect(v.config.tools).toBe(true);
    expect(v.config.reasoning).toBe(true);
    expect(v.config.reactiveIntelligence).toBe(true);
    expect(v.config.memory).toBe(true);
  });

  it("ra-full variant has no explicit verifier (defaults to default verifier)", () => {
    const v = getVariant("ra-full");
    if (v.type !== "internal") throw new Error("type narrow");
    expect(v.config.verifier).toBeUndefined();
  });

  it("session enumerates exactly 60 dispatch tuples (3 × 2 × 10 × 1)", () => {
    const tasks = resolveTasks(m3AblationSession, ALL_TASKS);
    const models = m3AblationSession.models;
    const variants = m3AblationSession.harnessVariants;
    const runs = m3AblationSession.runs ?? 1;
    const tupleCount = models.length * variants.length * tasks.length * runs;
    expect(models.length).toBe(3);
    expect(variants.length).toBe(2);
    expect(tasks.length).toBe(10);
    expect(runs).toBe(1);
    expect(tupleCount).toBe(60);
  });

  it("session pairs ra-full vs ra-full-noop-verifier exactly", () => {
    const ids = m3AblationSession.harnessVariants.map(v => v.id).sort();
    expect(ids).toEqual(["ra-full", "ra-full-noop-verifier"]);
  });

  it("session covers all 10 real-world tasks (rw-1 .. rw-10)", () => {
    const tasks = resolveTasks(m3AblationSession, ALL_TASKS);
    const ids = tasks.map(t => t.id).sort((a, b) => {
      const na = parseInt(a.split("-")[1] ?? "0", 10);
      const nb = parseInt(b.split("-")[1] ?? "0", 10);
      return na - nb;
    });
    expect(ids).toEqual([
      "rw-1", "rw-2", "rw-3", "rw-4", "rw-5",
      "rw-6", "rw-7", "rw-8", "rw-9", "rw-10",
    ]);
  });

  it("session model lineup: qwen3:14b, cogito:14b, gpt-4o-mini", () => {
    const models = m3AblationSession.models.map(m => m.model).sort();
    expect(models).toEqual(["cogito:14b", "gpt-4o-mini", "qwen3:14b"]);
  });
});
