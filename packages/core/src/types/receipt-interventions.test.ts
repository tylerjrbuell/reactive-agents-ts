// Run: bun test packages/core/src/types/receipt-interventions.test.ts
//
// Spec §5b (task #51 piece 3) — receipt.interventions[]: the harness's
// debugging spine. These pin the pure aggregation + a consumer read.

import { describe, it, expect } from "bun:test";
import {
  computeTrustReceipt,
  deriveInterventionsFromSteps,
  formatInterventions,
  type InterventionStepLike,
} from "./receipt.js";

const nudgeStep: InterventionStepLike = {
  metadata: {
    intervention: {
      actor: "ContentStability",
      authorityClass: "lexical",
      evidence: "outstanding requirements not yet satisfied: call web-search",
      whatChanged: "gate-redirect: run continued with outstanding criteria",
      iter: 2,
    },
  },
};
const plainStep: InterventionStepLike = { metadata: { intervention: undefined } };

describe("deriveInterventionsFromSteps", () => {
  it("collects intervention metadata off steps, in order, dropping plain steps", () => {
    const iv = deriveInterventionsFromSteps([plainStep, nudgeStep, plainStep]);
    expect(iv).toHaveLength(1);
    expect(iv[0]?.actor).toBe("ContentStability");
    expect(iv[0]?.authorityClass).toBe("lexical");
    expect(iv[0]?.iter).toBe(2);
  });

  it("empty / undefined input → no interventions (clean-run byte-identity)", () => {
    expect(deriveInterventionsFromSteps([])).toHaveLength(0);
    expect(deriveInterventionsFromSteps(undefined)).toHaveLength(0);
  });
});

describe("computeTrustReceipt — interventions passthrough", () => {
  it("populates receipt.interventions when present, with authorityClass", () => {
    const iv = deriveInterventionsFromSteps([nudgeStep]);
    const receipt = computeTrustReceipt({
      toolCalls: [],
      abstained: false,
      success: true,
      modelId: "test",
      interventions: iv,
      now: 0,
    });
    expect(receipt.interventions).toBeDefined();
    expect(receipt.interventions).toHaveLength(1);
    expect(receipt.interventions?.[0]?.authorityClass).toBe("lexical");
  });

  it("omits the field on a clean run (v1 byte-identity)", () => {
    const receipt = computeTrustReceipt({
      toolCalls: [],
      abstained: false,
      success: true,
      modelId: "test",
      now: 0,
    });
    expect(receipt.interventions).toBeUndefined();
  });
});

describe("formatInterventions — the consumer read", () => {
  it("renders the count header + one line per entry naming the authority class", () => {
    const receipt = computeTrustReceipt({
      toolCalls: [],
      abstained: false,
      success: true,
      modelId: "test",
      interventions: deriveInterventionsFromSteps([nudgeStep]),
      now: 0,
    });
    const rendered = formatInterventions(receipt);
    expect(rendered).toContain("Harness interventions (1)");
    expect(rendered).toContain("[lexical]");
    expect(rendered).toContain("ContentStability");
  });

  it("empty string when the run had no interventions", () => {
    const receipt = computeTrustReceipt({
      toolCalls: [],
      abstained: false,
      success: true,
      modelId: "test",
      now: 0,
    });
    expect(formatInterventions(receipt)).toBe("");
  });
});
