import { describe, it, expect, afterEach } from "bun:test";
import {
  validateNumericGrounding,
  buildEvidenceCorpusFromSteps,
  detectFabricatedMeasurement,
  resolveFabricationGuardMode,
} from "../../../src/kernel/capabilities/verify/evidence-grounding.js";
import type { ReasoningStep } from "../../../src/types/index.js";

describe("resolveFabricationGuardMode (explicit > env > default)", () => {
  const prev = process.env.RA_FABRICATION_GUARD;
  afterEach(() => {
    if (prev === undefined) delete process.env.RA_FABRICATION_GUARD;
    else process.env.RA_FABRICATION_GUARD = prev;
  });
  it("defaults to block when nothing is set", () => {
    delete process.env.RA_FABRICATION_GUARD;
    expect(resolveFabricationGuardMode()).toBe("block");
  });
  it("explicit value wins over env", () => {
    process.env.RA_FABRICATION_GUARD = "off";
    expect(resolveFabricationGuardMode("warn")).toBe("warn");
  });
  it("env killswitch applies when no explicit value (RA_FABRICATION_GUARD=off)", () => {
    process.env.RA_FABRICATION_GUARD = "off";
    expect(resolveFabricationGuardMode()).toBe("off");
  });
  it("ignores an unrecognised env value (falls back to default, never silently off)", () => {
    process.env.RA_FABRICATION_GUARD = "nonsense";
    expect(resolveFabricationGuardMode()).toBe("block");
  });
});

describe("detectFabricatedMeasurement (always-on fabrication guard)", () => {
  it("flags fabricated before/after benchmark timings (W2 rw-6 failure)", () => {
    const out =
      "Original Implementation: 10,000 elements took approximately 150 ms. Optimized: now 90 ms — a 40% reduction.";
    const r = detectFabricatedMeasurement(out, "the mergeSort source code, O(n log n)");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violations.some((v) => v.includes("150 ms"))).toBe(true);
      expect(r.violations.some((v) => v.includes("90 ms"))).toBe(true);
      expect(r.violations.some((v) => v.includes("40%"))).toBe(true);
    }
  });

  it("passes when the claimed timings ARE in the tool-observation corpus (real benchmark ran)", () => {
    const out = "Benchmark: sorting took 150 ms before and 90 ms after.";
    const corpus = "bench output: baseline=150ms candidate=90ms";
    expect(detectFabricatedMeasurement(out, corpus).ok).toBe(true);
  });

  it("passes when the answer makes NO empirical measurement claim", () => {
    const out =
      "The algorithm is already O(n log n), which is optimal for comparison sorts. No meaningful optimization exists.";
    expect(detectFabricatedMeasurement(out, "").ok).toBe(true);
  });

  it("does NOT fire on Big-O notation, input sizes, or counts (high precision)", () => {
    const out = "Sorting 10,000 elements is O(n log n) across all 8 tables in version 2.";
    expect(detectFabricatedMeasurement(out, "").ok).toBe(true);
  });

  it("does NOT fire on dollar figures (those are numeric-grounding's job, not this guard)", () => {
    const out = "The total cost is $50,000 and revenue is $120,000.";
    expect(detectFabricatedMeasurement(out, "").ok).toBe(true);
  });

  it("flags throughput claims absent from corpus", () => {
    const r = detectFabricatedMeasurement("Achieves 12000 ops/s after tuning.", "no benchmark was run");
    expect(r.ok).toBe(false);
  });

  it("flags keyword-before-number percentages (reduced by 35%)", () => {
    const r = detectFabricatedMeasurement("Latency reduced by 35% with the change.", "source code only");
    expect(r.ok).toBe(false);
  });

  it("flags natural phrasing 'performance improvement of approximately 28%' (real W2 ra-full output)", () => {
    const out =
      "This demonstrates a performance improvement of approximately 28%, primarily due to reduced memory allocations.";
    const r = detectFabricatedMeasurement(out, "the sort.ts source, no benchmark run");
    expect(r.ok).toBe(false);
  });

  it("does NOT fire on percentages WITHOUT a perf keyword nearby (28% of users, 20% market share)", () => {
    const out = "About 28% of users prefer dark mode and 20% of the market uses it.";
    expect(detectFabricatedMeasurement(out, "").ok).toBe(true);
  });

  it("flags distant-keyword phrasing within the sentence ('of about 25%, demonstrating the effectiveness of the optimizations')", () => {
    const out =
      "The hybrid approach yields a reduction of about 25%, demonstrating the effectiveness of the optimizations made.";
    expect(detectFabricatedMeasurement(out, "source only").ok).toBe(false);
  });

  it("grounds within tolerance (90 ms claim vs 90 in corpus)", () => {
    expect(detectFabricatedMeasurement("took 90 ms", "measured 90 milliseconds").ok).toBe(true);
  });
});

describe("validateNumericGrounding (tolerant value-match)", () => {
  it("grounds $62,578 against corpus 62578.12 (rounding tolerance)", () => {
    const r = validateNumericGrounding("BTC is $62,578 USD.", "price: 62578.12 usd", 0.01);
    expect(r.ok).toBe(true);
  });
  it("grounds $62.5k against corpus 62500 (magnitude suffix)", () => {
    expect(validateNumericGrounding("about $62.5k", "62500", 0.01).ok).toBe(true);
  });
  it("flags a fabricated figure absent from corpus", () => {
    const r = validateNumericGrounding("BTC is $80,000", "bitcoin price is 62578 usd as of today", 0.01);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations[0]).toContain("80,000");
  });
  it("passes when corpus is thin", () => {
    expect(validateNumericGrounding("$62,578", "x", 0.01).ok).toBe(true);
  });
  it("passes when output has no numeric claims", () => {
    expect(validateNumericGrounding("Bitcoin went up.", "price 62578 usd", 0.01).ok).toBe(true);
  });
});

describe("buildEvidenceCorpusFromSteps resolves storedKey to full data", () => {
  it("uses the scratchpad full value over the compressed step content", () => {
    const steps: ReasoningStep[] = [{
      id: "s1" as never, type: "observation", content: "[preview] item1 only", timestamp: new Date(),
      metadata: { storedKey: "_tool_result_1", observationResult: { toolName: "web-search" } as never },
    }];
    const scratch = new Map([["_tool_result_1", "item1 $10  item2 $9,999"]]);
    const corpus = buildEvidenceCorpusFromSteps(steps, scratch);
    expect(corpus).toContain("9,999"); // figure past the preview cutoff is present
  });
});
