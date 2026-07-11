// Run: bun test packages/runtime/tests/wave1-folds.test.ts
//
// Wave-1 additive folds (Q7): a config OPTION on a domain-opener wither must be
// equivalent to the standalone wither it folds — both write the SAME state slot,
// so `toConfig()` is identical. The ratchet is untouched (no new methods). These
// tests are the "both spellings equivalent" proof each fold owes.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

const base = () => ReactiveAgents.create().withName("x").withProvider("test");

describe("wave-1 folds — option ≡ standalone wither (same state slot)", () => {
  it("memory: withMemory({experienceLearning,memoryConsolidation}) ≡ standalone withers", () => {
    const folded = base()
      .withMemory({ tier: "enhanced", experienceLearning: true, memoryConsolidation: true })
      .toConfig();
    const standalone = base()
      .withMemory({ tier: "enhanced" })
      .withExperienceLearning()
      .withMemoryConsolidation()
      .toConfig();
    expect(folded).toEqual(standalone);
    expect(folded.memory?.experienceLearning).toBe(true);
    expect(folded.memory?.memoryConsolidation).toBe(true);
  });

  it("budget: withBudget({maxIterations,minIterations,timeout,llmTimeout}) ≡ standalone withers", () => {
    const folded = base()
      .withBudget({ maxIterations: 7, minIterations: 2, timeout: 30_000, llmTimeout: 60_000 })
      .toConfig();
    const standalone = base()
      .withMaxIterations(7)
      .withMinIterations(2)
      .withTimeout(30_000)
      .withLlmTimeout(60_000)
      .toConfig();
    expect(folded).toEqual(standalone);
    expect(folded.execution?.maxIterations).toBe(7);
    expect(folded.execution?.minIterations).toBe(2);
    expect(folded.execution?.timeoutMs).toBe(30_000);
  });

  it("budget: spend cap alongside execution caps still round-trips", () => {
    const cfg = base()
      .withBudget({ tokenLimit: 100_000, maxIterations: 9 })
      .toConfig();
    expect(cfg.budget?.tokenLimit).toBe(100_000);
    expect(cfg.execution?.maxIterations).toBe(9);
  });

  it("budget: an empty budget call still throws (guard preserved)", () => {
    expect(() => base().withBudget({})).toThrow(/withBudget/);
  });

  it("grounding (Q3): withGrounding({fabricationGuard,stallPolicy}) ≡ standalone withers", () => {
    const folded = base()
      .withGrounding({ mode: "warn", fabricationGuard: "off", stallPolicy: { ignoredNudgeTolerance: 1 } })
      .toConfig();
    const standalone = base()
      .withGrounding({ mode: "warn" })
      .withFabricationGuard("off")
      .withStallPolicy({ ignoredNudgeTolerance: 1 })
      .toConfig();
    expect(folded).toEqual(standalone);
    expect(folded.fabricationGuard).toBe("off");
    expect(folded.stallPolicy?.ignoredNudgeTolerance).toBe(1);
    // Fold does NOT change grounding's opt-in defaults: grounding is only set
    // because we asked for it; the guard default (block) is untouched when absent.
    const noGuard = base().withGrounding({ mode: "warn" }).toConfig();
    expect(noGuard.fabricationGuard).toBeUndefined();
    expect(noGuard.grounding?.mode).toBe("warn");
  });

  it("verification: withVerification({strictValidation,lazyValidation}) ≡ standalone withers", () => {
    const folded = base()
      .withVerification({ passThreshold: 0.8, strictValidation: true, lazyValidation: true })
      .toConfig();
    const standalone = base()
      .withVerification({ passThreshold: 0.8 })
      .withStrictValidation()
      .withLazyValidation()
      .toConfig();
    expect(folded).toEqual(standalone);
    expect(folded.execution?.strictValidation).toBe(true);
    expect(folded.verification?.passThreshold).toBe(0.8);
  });

  it("Q2: withObservability({costs}) shares the cost-tracking state slot with withCostTracking()", () => {
    const viaObs = base().withObservability({ costs: { daily: 5 } }).toConfig();
    const viaCost = base().withCostTracking({ daily: 5 }).toConfig();
    // Both write the same _enableCostTracking/_costTrackingOptions slot → same
    // top-level costTracking serialization.
    expect(viaObs.costTracking).toEqual({ daily: 5 });
    expect(viaCost.costTracking).toEqual({ daily: 5 });
  });

  it("Q1: withCortex / withTracing stay standalone AND are observability aliases", () => {
    // Both spellings exist (ratchet: no method removed).
    expect(typeof base().withCortex).toBe("function");
    expect(typeof base().withTracing).toBe("function");
    // The observability-form round-trips (the alias that serializes).
    const cfg = base()
      .withObservability({ cortex: { url: "http://h:1" }, tracing: { dir: "/t" } })
      .toConfig();
    expect(cfg.observability?.cortex).toEqual({ url: "http://h:1" });
    expect(cfg.observability?.tracing).toEqual({ dir: "/t" });
  });
});
