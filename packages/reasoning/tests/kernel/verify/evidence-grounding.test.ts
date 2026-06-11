import { describe, it, expect } from "bun:test";
import {
  validateNumericGrounding,
  buildEvidenceCorpusFromSteps,
} from "../../../src/kernel/capabilities/verify/evidence-grounding.js";
import type { ReasoningStep } from "../../../src/types/index.js";

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
