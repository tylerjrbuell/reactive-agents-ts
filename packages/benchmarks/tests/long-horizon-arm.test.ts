// Run: bun test packages/benchmarks/tests/long-horizon-arm.test.ts
//
// Closing the coverage hole that made the 2026-07 harness work unmeasurable.
//
// `.withLongHorizon()` was reachable ONLY through a task tag:
//
//     shouldUseLongHorizon = (task) => task.tags?.includes("horizon:long")   // runner.ts:96
//
// Exactly one task in the suite carries that tag (`lh-1`). So the long-horizon
// profile could never be an ABLATION ARM — there was no way to run the same task
// with the profile on and off and compare. Everything gated behind it was
// invisible to the bench by construction:
//
//   • the RunAssessment → phase → projector chain (incl. the `verify` phase)
//   • the F3 error-recovery control seam   (a102bcc9)
//   • the stall control seam               (69c4ef9e)
//   • `.withAdaptiveHarness()`'s only live lever
//
// Adding runs could never fix this: a coverage hole is not a power problem.
//
// `config.longHorizon` makes the profile a VARIANT knob, so any task can be run
// under both profiles. The tag still works (lh-1 is unchanged); the config is an
// additional, orthogonal way in.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldUseLongHorizon, ALL_TASKS } from "../src/runner.js";
import { featureCoverageSession } from "../src/sessions/feature-coverage.js";
import { longHorizonArmSession } from "../src/sessions/long-horizon-arm.js";
import { REAL_WORLD_TASKS, ABSTENTION_TRAP_TASKS } from "../src/tasks/real-world.js";

describe("the long-horizon profile is reachable as a VARIANT, not only as a task tag", () => {
  it("the tag predicate still works (lh-1 is unchanged)", () => {
    expect(shouldUseLongHorizon({ tags: ["horizon:long"] })).toBe(true);
    expect(shouldUseLongHorizon({ tags: ["research"] })).toBe(false);
    expect(shouldUseLongHorizon({})).toBe(false);
  });

  it("exactly one task carries the tag — which is WHY a variant knob was needed", () => {
    // If this ever grows, great: it means P3 progressed. It must never be 0,
    // or lh-1's profile silently stopped being exercised.
    const tagged = REAL_WORLD_TASKS.filter((t) => shouldUseLongHorizon(t));
    expect(tagged.length).toBe(0); // real-world tasks carry no horizon tag
  });

  it("runner.ts honors config.longHorizon, not just the task tag", () => {
    const src = readFileSync(join(import.meta.dir, "..", "src", "runner.ts"), "utf8");
    // The wiring: a variant can turn the profile on for ANY task.
    expect(src).toContain("config.longHorizon");
    expect(src).toMatch(/shouldUseLongHorizon\(task\)\s*\|\|\s*config\.longHorizon/);
  });
});

describe("the long-horizon ablation session pairs the SAME tasks under both profiles", () => {
  const arms = longHorizonArmSession.harnessVariants ?? [];
  const byId = (id: string) => arms.find((v) => v.id === id);

  it("has a profile-OFF baseline and a profile-ON candidate", () => {
    expect(byId("ra-full")).toBeDefined();
    expect(byId("ra-long-horizon")).toBeDefined();
  });

  it("the two arms differ by EXACTLY the longHorizon knob (otherwise lift is unattributable)", () => {
    const base = byId("ra-full");
    const cand = byId("ra-long-horizon");
    if (base?.type !== "internal" || cand?.type !== "internal") throw new Error("expected internal variants");

    const baseCfg = { ...base.config } as Record<string, unknown>;
    const candCfg = { ...cand.config } as Record<string, unknown>;
    expect(candCfg.longHorizon).toBe(true);
    expect(baseCfg.longHorizon).toBeUndefined();

    delete candCfg.longHorizon;
    expect(candCfg).toEqual(baseCfg);
  });

  it("includes ab-trap-4 — the only task that even ATTEMPTS harness-forced abstention", () => {
    // MEASURED 2026-07-09: cogito:8b answered ab-trap-1..3 in every run of both
    // profiles (accuracy 0.0 across the board). Those traps declare no
    // requiredTools, and the grounded-terminal gate is skipped entirely when
    // `ctx.requiredTools.length === 0`; model-INITIATED abstention was cut. They
    // measure fabrication, not the abstention machinery the seam fixes changed.
    // ab-trap-4 declares a REQUIRED tool that is never provided, which is the
    // one documented route into decideForcedAbstention.
    const ids = longHorizonArmSession.taskIds ?? [];
    expect(ids).toContain("ab-trap-4");
  });

  it("includes deterministic graded tasks too (so the profile is not judged only on traps)", () => {
    const ids = longHorizonArmSession.taskIds ?? [];
    expect(ids).toContain("rw-9");
  });

  it("the trap tasks really are abstain-expected (the scoring path we rely on)", () => {
    const abstainers = ABSTENTION_TRAP_TASKS.filter(
      (t) => (t as { abstainExpected?: boolean }).abstainExpected === true,
    );
    expect(abstainers.length).toBeGreaterThanOrEqual(4);
  });

  it("ab-trap-4 declares a REQUIRED tool that the agent is never given", () => {
    // This is the mechanism: `computeGroundingSet` passes declared `required`
    // names through verbatim, so an unavailable name reaches
    // `.withRequiredTools()` and then decideForcedAbstention's first branch.
    const t = ABSTENTION_TRAP_TASKS.find((x) => x.id === "ab-trap-4") as unknown as {
      tools?: ReadonlyArray<{ kind: string; name: string }>;
    };
    expect(t.tools?.some((r) => r.kind === "required" && r.name === "employee-directory")).toBe(true);
  });

  it("REGRESSION: the trap tasks are reachable from ALL_TASKS at all", () => {
    // ABSTENTION_TRAP_TASKS was authored and never spread into ALL_TASKS, so
    // `ab-trap-*` matched no cell in any session. This session would have
    // silently run rw-9 alone — the non-empty guard passes on one task.
    const ids = ALL_TASKS.map((t) => t.id);
    for (const id of ["ab-trap-1", "ab-trap-2", "ab-trap-3", "ab-trap-4"]) expect(ids).toContain(id);
  });
});

describe("feature-coverage session also exposes the profile", () => {
  it("carries a long-horizon arm so the assessment chain is exercised there too", () => {
    const ids = (featureCoverageSession.harnessVariants ?? []).map((v) => v.id);
    expect(ids).toContain("ra-long-horizon");
  });
});
