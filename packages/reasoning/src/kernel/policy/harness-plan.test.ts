// File: src/kernel/policy/harness-plan.test.ts
//
// Unit tests for the Policy Compiler (task G1). Pure functions — no Layer, no
// LLM, no fs. Covers: capability/horizon/classification → plan mapping, the
// wither-override semantics (explicit wins; horizonProfile subsumes A2's flag),
// and the bounded mid-run recompile (deepen on struggle / lean on flow).

import { describe, expect, it } from "bun:test";
import { classifyTask } from "../capabilities/comprehend/task-classification.js";
import type { RunAssessment } from "../assessment/assess.js";
import {
  applyExplicitOverrides,
  compileHarnessPlan,
  MAX_SCAFFOLDING,
  recompileOnAssessment,
  type HarnessPlan,
  type HarnessPlanInputs,
} from "./harness-plan.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const inputs = (over: Partial<HarnessPlanInputs> & { task?: string }): HarnessPlanInputs => {
  const task = over.task ?? "Summarize the given text.";
  return {
    capability: over.capability ?? { tier: "mid" },
    ...(over.calibration ? { calibration: over.calibration } : {}),
    horizon: over.horizon ?? "short",
    classification: over.classification ?? classifyTask(task),
  };
};

/** A neutral, steady assessment (neither struggling nor cleanly flowing). */
const steadyAssessment = (over: Partial<RunAssessment["health"]> & { evidenceDelta?: number } = {}): RunAssessment => ({
  requirements: { satisfied: [], outstanding: [], blocked: [] },
  deliverables: { produced: [], missing: [] },
  evidenceDelta: over.evidenceDelta ?? 0,
  phase: "gather",
  pace: { burnRatio: 0.2, projectedCompletion: 0.2, band: "green" },
  health: {
    recentFailures: over.recentFailures ?? 1,
    consecutiveFailures: over.consecutiveFailures ?? 0,
    repeatWaste: over.repeatWaste ?? 0,
    stuckSignals: over.stuckSignals ?? 0,
    contradictions: over.contradictions ?? 0,
    iterationsSinceEvidence: over.iterationsSinceEvidence ?? 0,
    failureArgVariety: over.failureArgVariety ?? 0,
  },
});

// ─── compileHarnessPlan ──────────────────────────────────────────────────────

describe("compileHarnessPlan", () => {
  it("a long-horizon contract compiles to horizonProfile 'long'", () => {
    const plan = compileHarnessPlan(inputs({ horizon: "long" }));
    expect(plan.guard.horizonProfile).toBe("long");
    expect(plan.budget.budgetClass).toBe("generous");
    expect(plan.budget.maxIterations).toBeGreaterThanOrEqual(40);
  });

  it("a short-horizon task leaves horizonProfile unset", () => {
    const plan = compileHarnessPlan(inputs({ horizon: "short" }));
    expect(plan.guard.horizonProfile).toBeUndefined();
  });

  it("a weak (local) model gets deeper scaffolding than a strong (frontier) one", () => {
    const weak = compileHarnessPlan(inputs({ capability: { tier: "local" } }));
    const strong = compileHarnessPlan(inputs({ capability: { tier: "frontier" } }));
    expect(weak.guard.scaffoldingLevel).toBeGreaterThan(strong.guard.scaffoldingLevel);
    expect(weak.verifierTier).toBe("checker");
    expect(strong.verifierTier).toBe("none");
  });

  it("a strong model on a simple task is lean", () => {
    const plan = compileHarnessPlan(
      inputs({ capability: { tier: "frontier" }, horizon: "short", task: "What is 2 + 2?" }),
    );
    expect(plan.guard.scaffoldingLevel).toBe(0);
    expect(plan.verifierTier).toBe("none");
    expect(plan.budget.budgetClass).toBe("lean");
    expect(plan.strategy).toBe("direct");
    expect(plan.toolSurface).toBe("full");
    expect(plan.memoryPosture).toBe("off");
  });

  it("calibration weak-attention + hallucinate-risk deepen the plan", () => {
    const baseline = compileHarnessPlan(inputs({ capability: { tier: "mid" } }));
    const deepened = compileHarnessPlan(
      inputs({
        capability: { tier: "mid" },
        calibration: {
          modelId: "test",
          calibratedAt: "2026-07-08",
          probeVersion: 1,
          runsAveraged: 1,
          steeringCompliance: "hybrid",
          parallelCallCapability: "sequential-only",
          observationHandling: "hallucinate-risk",
          systemPromptAttention: "weak",
          optimalToolResultChars: 800,
          toolCallDialect: "none",
        },
      }),
    );
    expect(deepened.guard.scaffoldingLevel).toBeGreaterThan(baseline.guard.scaffoldingLevel);
    expect(deepened.verifierTier).toBe("checker");
  });

  it("scaffolding never exceeds MAX_SCAFFOLDING", () => {
    const plan = compileHarnessPlan(
      inputs({
        capability: { tier: "local" },
        horizon: "long",
        calibration: {
          modelId: "test",
          calibratedAt: "2026-07-08",
          probeVersion: 1,
          runsAveraged: 1,
          steeringCompliance: "hybrid",
          parallelCallCapability: "sequential-only",
          observationHandling: "hallucinate-risk",
          systemPromptAttention: "weak",
          optimalToolResultChars: 800,
          toolCallDialect: "none",
        },
      }),
    );
    expect(plan.guard.scaffoldingLevel).toBeLessThanOrEqual(MAX_SCAFFOLDING);
  });

  it("is deterministic — same inputs → identical plan", () => {
    const a = compileHarnessPlan(inputs({ horizon: "long", capability: { tier: "large" } }));
    const b = compileHarnessPlan(inputs({ horizon: "long", capability: { tier: "large" } }));
    expect(a).toEqual(b);
  });

  it("returns a frozen plan", () => {
    const plan = compileHarnessPlan(inputs({}));
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.guard)).toBe(true);
    expect(Object.isFrozen(plan.budget)).toBe(true);
  });
});

// ─── applyExplicitOverrides (wither semantics) ───────────────────────────────

describe("applyExplicitOverrides", () => {
  it("an explicit wither overrides the compiled default", () => {
    const plan = compileHarnessPlan(inputs({ capability: { tier: "frontier" }, task: "What is 2 + 2?" }));
    expect(plan.strategy).toBe("direct");
    const overridden = applyExplicitOverrides(plan, { strategy: "blueprint", budgetClass: "generous" });
    expect(overridden.strategy).toBe("blueprint");
    expect(overridden.budget.budgetClass).toBe("generous");
  });

  it("absent override fields leave the plan value untouched", () => {
    const plan = compileHarnessPlan(inputs({ horizon: "long" }));
    const same = applyExplicitOverrides(plan, {});
    expect(same.strategy).toBe(plan.strategy);
    expect(same.guard.horizonProfile).toBe("long");
    expect(same.verifierTier).toBe(plan.verifierTier);
  });

  it("horizonProfile override subsumes A2's flag — .withLongHorizon() forces 'long' on a short task", () => {
    const shortPlan = compileHarnessPlan(inputs({ horizon: "short" }));
    expect(shortPlan.guard.horizonProfile).toBeUndefined();
    const forced = applyExplicitOverrides(shortPlan, { horizonProfile: "long" });
    expect(forced.guard.horizonProfile).toBe("long");
  });

  it("returns a frozen plan", () => {
    const plan = applyExplicitOverrides(compileHarnessPlan(inputs({})), { strategy: "reactive" });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.guard)).toBe(true);
  });
});

// ─── recompileOnAssessment (mid-run adaptive lever) ──────────────────────────

describe("recompileOnAssessment", () => {
  const leanBase: HarnessPlan = compileHarnessPlan(
    inputs({ capability: { tier: "frontier" }, task: "What is 2 + 2?" }),
  );

  it("high consecutiveFailures DEEPENS the plan", () => {
    const rc = recompileOnAssessment(leanBase, steadyAssessment({ consecutiveFailures: 3 }));
    expect(rc.changed).toBe(true);
    expect(rc.direction).toBe("deepen");
    expect(rc.plan.guard.scaffoldingLevel).toBe(leanBase.guard.scaffoldingLevel + 1);
    expect(rc.plan.guard.horizonProfile).toBe("long");
    expect(rc.plan.source).toBe("recompiled");
    expect(rc.reason).toContain("deepen");
  });

  it("no new evidence for several iterations DEEPENS the plan", () => {
    const rc = recompileOnAssessment(
      leanBase,
      steadyAssessment({ evidenceDelta: 0, iterationsSinceEvidence: 4 }),
    );
    expect(rc.direction).toBe("deepen");
    expect(rc.changed).toBe(true);
  });

  it("a clean, flowing trajectory LEANS a scaffolded plan", () => {
    const scaffolded = compileHarnessPlan(inputs({ capability: { tier: "local" } }));
    expect(scaffolded.guard.scaffoldingLevel).toBeGreaterThan(0);
    const rc = recompileOnAssessment(
      scaffolded,
      steadyAssessment({ consecutiveFailures: 0, recentFailures: 0, stuckSignals: 0, evidenceDelta: 2 }),
    );
    expect(rc.changed).toBe(true);
    expect(rc.direction).toBe("lean");
    expect(rc.plan.guard.scaffoldingLevel).toBe(scaffolded.guard.scaffoldingLevel - 1);
    expect(rc.plan.source).toBe("recompiled");
  });

  it("a lean plan that is flowing cannot lean below zero (bounded, no change)", () => {
    const rc = recompileOnAssessment(
      leanBase,
      steadyAssessment({ consecutiveFailures: 0, recentFailures: 0, stuckSignals: 0, evidenceDelta: 2 }),
    );
    expect(rc.changed).toBe(false);
    expect(rc.direction).toBe("none");
  });

  it("deepen is bounded — a maxed plan does not change", () => {
    // Deepen repeatedly until saturated, then assert no further change.
    let plan = compileHarnessPlan(inputs({ capability: { tier: "local" }, horizon: "long" }));
    const struggling = steadyAssessment({ consecutiveFailures: 5 });
    for (let i = 0; i < 10; i++) {
      const rc = recompileOnAssessment(plan, struggling);
      if (!rc.changed) break;
      plan = rc.plan;
    }
    expect(plan.guard.scaffoldingLevel).toBe(MAX_SCAFFOLDING);
    const final = recompileOnAssessment(plan, struggling);
    expect(final.changed).toBe(false);
    expect(final.direction).toBe("none");
  });

  it("a steady (neither struggling nor cleanly flowing) run does not recompile", () => {
    const rc = recompileOnAssessment(leanBase, steadyAssessment({ recentFailures: 1, evidenceDelta: 0 }));
    expect(rc.changed).toBe(false);
    expect(rc.direction).toBe("none");
  });

  it("takes at most one bounded step per call", () => {
    const scaffolded = compileHarnessPlan(inputs({ capability: { tier: "mid" }, horizon: "long" }));
    const rc = recompileOnAssessment(scaffolded, steadyAssessment({ consecutiveFailures: 9 }));
    expect(rc.plan.guard.scaffoldingLevel - scaffolded.guard.scaffoldingLevel).toBeLessThanOrEqual(1);
  });
});
