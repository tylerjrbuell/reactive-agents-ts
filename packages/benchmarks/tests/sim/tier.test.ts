// Run: bun run repo test packages/benchmarks/tests/sim/tier.test.ts
// Phase Z stochastic layer: tier files, seeded determinism, compliance sweep. Zero tokens.
import { describe, expect, it } from "bun:test";
import { MECHANISMS } from "../../src/sim/mechanisms.js";
import { iterationCap, noCallStall } from "../../src/sim/shapes/index.js";
import { loadTier, tierNames } from "../../src/sim/tier.js";
import { runCell, sweep } from "./matrix.js";
import { runArm } from "./run-shape.js";
import { armConfig } from "../../src/sim/mechanisms.js";

const hint = MECHANISMS.find((m) => m.name === "parallelToolHint")!;

describe("tier files", () => {
  it("validate against the schema, carry every field, and are honestly marked uncalibrated", () => {
    expect(tierNames().length).toBeGreaterThanOrEqual(3);
    for (const name of tierNames()) {
      const t = loadTier(name);
      expect(t.name).toBe(name);
      expect(t.status).toBe("uncalibrated");
      expect(t.provenance).toContain("UNCALIBRATED");
      for (const p of [t.pStall, t.pPrematureFinal, t.pRepeat, t.pHallucinatedTool, t.pDecline, t.complianceGivenGuidance]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("seeded stochastic layer", () => {
  it("same seed and tier: identical request log; another seed can differ", async () => {
    const tier = { ...loadTier("small-local"), pStall: 0.4, pHallucinatedTool: 0.2 };
    const a = await runArm(iterationCap, armConfig(), { seed: 3, tier });
    const b = await runArm(iterationCap, armConfig(), { seed: 3, tier });
    expect(a.trace).toBe(b.trace);
    const others = await Promise.all([4, 5, 6, 7].map((seed) => runArm(iterationCap, armConfig(), { seed, tier })));
    expect(others.some((o) => o.trace !== a.trace)).toBe(true);
  }, 30000);

  it("a tier with every failure rate at 0 plays the shape's own script", async () => {
    const tier = { ...loadTier("frontier"), pStall: 0, pPrematureFinal: 0, pRepeat: 0, pHallucinatedTool: 0, pDecline: 0 };
    const plain = await runArm(noCallStall, armConfig(), { seed: 1 });
    const tiered = await runArm(noCallStall, armConfig(), { seed: 1, tier });
    expect(tiered.toolSeq).toEqual(plain.toolSeq);
    expect(tiered.status).toBe(plain.status);
  }, 30000);

  it("paired arms share randomness: a mechanism with no effect is inert on every seed", async () => {
    const tier = loadTier("small-local");
    const write = MECHANISMS.find((m) => m.name === "writeCoverage")!;
    const cell = await runCell(noCallStall, write, { seeds: 6, tier });
    expect(cell.verdict).toBe("inert");
    expect(cell.wins + cell.losses).toBe(0);
  }, 60000);
});

describe("compliance sweep", () => {
  it("parallelToolHint on the sequential-calls shape: neutral at 0 compliance, helps once models follow it", async () => {
    const s = await sweep(iterationCap, hint, { tier: loadTier("mid-local"), seeds: 12, levels: [0, 1] });
    expect(s.rows[0]!.cell.verdict).toBe("neutral");
    expect(s.rows[1]!.cell.verdict).toBe("helps");
    expect(s.rows[1]!.cell.onMeets).toBeGreaterThan(s.rows[1]!.cell.offMeets);
    expect(s.pattern).toBe("never-harmful");
  }, 60000);
});
