// Run: bun test packages/runtime/tests/max-iterations-explicit-config.test.ts
//
// 2026-10-23 introspective harness loop — explicit maxIterations wiring (A).
//
// `resolveReasoningConfig` is the single builder→strategy seam that must stamp
// `maxIterationsExplicit: true` whenever the developer declared a cap (via
// `.withMaxIterations()` / `.withReasoning({ maxIterations })`, both of which
// the builder folds into `options.maxIterations`, or directly through
// `strategies.reactive.maxIterations`). Without the stamp, reactive.ts cannot
// distinguish an explicit 10/12/20 from the schema fallback 10 and min()
// steals it down to the tier context-profile hint (8 on local tier) — the
// exact truncation proven in trace 01M5NVA1211VFYAQFEJ7CE2GNJ seq 178.

import { describe, it, expect } from "bun:test";
import { resolveReasoningConfig } from "../src/runtime.js";
import type { ReasoningOptions } from "../src/types.js";

const opts = (
  enableReasoning: boolean | undefined,
  reasoningOptions: ReasoningOptions | undefined,
  maxIterations: number | undefined,
) => ({ enableReasoning, reasoningOptions, maxIterations });

describe("resolveReasoningConfig — maxIterationsExplicit stamping", () => {
  it("bare path with a declared cap stamps explicit + the value", () => {
    const cfg = resolveReasoningConfig(opts(false, undefined, 10));
    expect(cfg.strategies.reactive.maxIterations).toBe(10);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("bare path WITHOUT a declared cap stays unset (tier hint may clamp)", () => {
    const cfg = resolveReasoningConfig(opts(false, undefined, undefined));
    expect(cfg.strategies.reactive.maxIterations).toBe(10); // schema fallback
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBeUndefined();
  });

  it(".withReasoning({ maxIterations }) folded to options.maxIterations stamps explicit", () => {
    const cfg = resolveReasoningConfig(
      opts(true, { defaultStrategy: "reactive" }, 20),
    );
    expect(cfg.strategies.reactive.maxIterations).toBe(20);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("strategies.reactive.maxIterations declared directly stamps explicit", () => {
    const cfg = resolveReasoningConfig(
      opts(true, { strategies: { reactive: { maxIterations: 12, temperature: 0.7 } } }, undefined),
    );
    expect(cfg.strategies.reactive.maxIterations).toBe(12);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("builder-level cap WINS over a strategies-level cap and stays explicit", () => {
    const cfg = resolveReasoningConfig(
      opts(
        true,
        { strategies: { reactive: { maxIterations: 20, temperature: 0.7 } } },
        5,
      ),
    );
    expect(cfg.strategies.reactive.maxIterations).toBe(5);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("withReasoning without any cap leaves the fallback unmarked", () => {
    const cfg = resolveReasoningConfig(opts(true, { defaultStrategy: "reactive" }, undefined));
    expect(cfg.strategies.reactive.maxIterations).toBe(10);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBeUndefined();
  });

  it("enableReasoning with no reasoningOptions yields the untouched default", () => {
    const cfg = resolveReasoningConfig(opts(true, undefined, undefined));
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBeUndefined();
  });
});

describe("resolveReasoningConfig — behavioral-contract tightening (bridge invariant)", () => {
  it("contract cap TIGHTER than the builder cap wins (min fold, explicit stamp)", () => {
    const cfg = resolveReasoningConfig({
      ...opts(false, undefined, 5),
      behavioralContract: { maxIterations: 1 },
    });
    expect(cfg.strategies.reactive.maxIterations).toBe(1);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("contract cap over an unmarked face folds against the resolved tier hint", () => {
    const cfg = resolveReasoningConfig({
      ...opts(false, undefined, undefined),
      behavioralContract: { maxIterations: 12 },
      contextProfile: { maxIterations: 8 },
    });
    expect(cfg.strategies.reactive.maxIterations).toBe(8); // min(8, 12) — tighten only
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("contract cap never LOOSENS the schema fallback (face 10 without hint)", () => {
    const cfg = resolveReasoningConfig({
      ...opts(false, undefined, undefined),
      behavioralContract: { maxIterations: 30 },
    });
    expect(cfg.strategies.reactive.maxIterations).toBe(10);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("contract with strategies-level cap: strategies cap is the face", () => {
    const cfg = resolveReasoningConfig({
      ...opts(true, { strategies: { reactive: { maxIterations: 12, temperature: 0.7 } } }, undefined),
      behavioralContract: { maxIterations: 20 },
    });
    expect(cfg.strategies.reactive.maxIterations).toBe(12); // min(12, 20)
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBe(true);
  });

  it("absent/invalid contract cap does not fold", () => {
    const cfg = resolveReasoningConfig({
      ...opts(false, undefined, undefined),
      behavioralContract: { maxIterations: 0 },
    });
    expect(cfg.strategies.reactive.maxIterations).toBe(10);
    expect(cfg.strategies.reactive.maxIterationsExplicit).toBeUndefined();
  });
});
