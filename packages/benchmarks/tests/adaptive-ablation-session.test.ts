// File: tests/adaptive-ablation-session.test.ts
//
// Config-shape test for the G3 adaptive-harness ablation. Validates the three
// arms (ra-minimal / ra-full / ra-adaptive), the config→wither mapping contract
// (ra-adaptive = ra-full + adaptiveHarness), the byte-identical pin (non-adaptive
// variants carry no adaptiveHarness flag), and that the session resolves to the
// real-world + lh-1 task set across both local models — all without any LLM call.

import { describe, it, expect } from "bun:test";
import { getVariant, resolveTasks, ABLATION_VARIANTS } from "../src/session.js";
import { adaptiveAblationSession } from "../src/sessions/adaptive-ablation.js";
import { BENCHMARK_TASKS } from "../src/task-registry.js";
import { REAL_WORLD_TASKS } from "../src/tasks/real-world.js";
import { LONG_HORIZON_TASKS } from "../src/tasks/long-horizon.js";

const ALL_TASKS = [...BENCHMARK_TASKS, ...REAL_WORLD_TASKS, ...LONG_HORIZON_TASKS];

describe("G3 adaptive ablation — config shape", () => {
  it("session registers exactly the three arms: ra-minimal, ra-full, ra-adaptive", () => {
    const ids = adaptiveAblationSession.harnessVariants.map(v => v.id);
    expect(ids).toEqual(["ra-minimal", "ra-full", "ra-adaptive"]);
  });

  it("ra-adaptive = ra-full config + adaptiveHarness: true", () => {
    const adaptive = adaptiveAblationSession.harnessVariants.find(v => v.id === "ra-adaptive");
    if (!adaptive || adaptive.type !== "internal") throw new Error("ra-adaptive not found / not internal");
    const full = getVariant("ra-full");
    if (full.type !== "internal") throw new Error("ra-full not internal");
    // Same surface as ra-full…
    expect(adaptive.config.tools).toBe(true);
    expect(adaptive.config.reasoning).toBe(true);
    expect(adaptive.config.reactiveIntelligence).toBe(true);
    expect(adaptive.config.memory).toBe(true);
    // …with the ONE additive difference that maps to builder.withAdaptiveHarness().
    expect(adaptive.config.adaptiveHarness).toBe(true);
    // ra-full's config minus the flag is exactly ra-adaptive's config.
    expect(adaptive.config).toEqual({ ...full.config, adaptiveHarness: true });
  });

  it("ra-minimal is the lean baseline: tools + reasoning only, no adaptiveHarness", () => {
    const minimal = adaptiveAblationSession.harnessVariants.find(v => v.id === "ra-minimal");
    if (!minimal || minimal.type !== "internal") throw new Error("ra-minimal not found / not internal");
    expect(minimal.config.tools).toBe(true);
    expect(minimal.config.reasoning).toBe(true);
    expect(minimal.config.reactiveIntelligence).toBeUndefined();
    expect(minimal.config.memory).toBeUndefined();
    expect(minimal.config.adaptiveHarness).toBeUndefined();
    // Same lean config as the ladder's `ra-reasoning` arm (re-labelled).
    const raReasoning = getVariant("ra-reasoning");
    if (raReasoning.type !== "internal") throw new Error("ra-reasoning not internal");
    expect(minimal.config).toEqual(raReasoning.config);
  });

  it("byte-identical pin: NO shared-ladder variant carries adaptiveHarness", () => {
    for (const v of ABLATION_VARIANTS) {
      if (v.type !== "internal") continue;
      expect(v.config.adaptiveHarness).toBeUndefined();
    }
  });

  it("byte-identical pin: ra-full arm is untouched (config has no adaptiveHarness)", () => {
    const full = adaptiveAblationSession.harnessVariants.find(v => v.id === "ra-full");
    // It is literally the canonical ladder variant, not a copy (identity check
    // before narrowing so both sides stay HarnessVariant).
    expect(full).toBe(getVariant("ra-full"));
    if (!full || full.type !== "internal") throw new Error("ra-full not found / not internal");
    expect(full.config.adaptiveHarness).toBeUndefined();
  });

  it("session resolves to the real-world execution set + lh-1", () => {
    const tasks = resolveTasks(adaptiveAblationSession, ALL_TASKS);
    const ids = tasks.map(t => t.id).sort();
    expect(ids).toEqual(["lh-1", "rw-1", "rw-2", "rw-7", "rw-8", "rw-9"]);
  });

  it("session runs both local models (qwen3:14b + cogito:8b, contextTier local)", () => {
    const models = adaptiveAblationSession.models;
    expect(models.map(m => m.model).sort()).toEqual(["cogito:8b", "qwen3:14b"]);
    for (const m of models) expect(m.contextTier).toBe("local");
  });

  it("dry-run fan-out: 2 models × 3 variants × 6 tasks × 3 runs = 108 tuples", () => {
    const tasks = resolveTasks(adaptiveAblationSession, ALL_TASKS);
    const models = adaptiveAblationSession.models;
    const variants = adaptiveAblationSession.harnessVariants;
    const runs = adaptiveAblationSession.runs ?? 1;
    expect(models.length).toBe(2);
    expect(variants.length).toBe(3);
    expect(tasks.length).toBe(6);
    expect(runs).toBe(3);
    expect(models.length * variants.length * tasks.length * runs).toBe(108);
  });
});
