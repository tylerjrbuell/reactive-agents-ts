/**
 * evidence-grounding-guard.test.ts
 *
 * Unit tests for guardEvidenceGrounding in think-guards.ts.
 */
import { describe, it, expect } from "bun:test";
import { guardEvidenceGrounding } from "../../../../src/kernel/capabilities/reason/think-guards.js";
import type { KernelState } from "../../../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../../src/types/index.js";

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "test",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 1, // > 0 so guard is eligible
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  } as KernelState;
}

function obsStep(content: string, toolName = "web-search", extractedFact?: string): ReasoningStep {
  return {
    type: "observation",
    content,
    metadata: {
      observationResult: { toolName, success: true },
      ...(extractedFact ? { extractedFact } : {}),
    },
  } as unknown as ReasoningStep;
}

const EVIDENCE_STEPS: readonly ReasoningStep[] = [
  obsStep("ETH last 2,208.24 USD per Yahoo Finance; BTC 71,535.42"),
  obsStep("XRP spot ~$1.37 on CoinMarketCap"),
];

describe("guardEvidenceGrounding", () => {
  it("returns undefined when no dollar amounts in output", () => {
    const state = makeState();
    const result = guardEvidenceGrounding(state, "The prices are very high.", EVIDENCE_STEPS, 10, 0);
    expect(result).toBeUndefined();
  });

  it("returns undefined when all dollar amounts are grounded in evidence", () => {
    const state = makeState();
    const output = "ETH is $2,208.24 and BTC is $71,535.42.";
    const result = guardEvidenceGrounding(state, output, EVIDENCE_STEPS, 10, 0);
    expect(result).toBeUndefined();
  });

  it("redirects when output contains an ungrounded dollar amount", () => {
    const state = makeState();
    const output = "ETH is $3,500.00 today."; // not in evidence
    const result = guardEvidenceGrounding(state, output, EVIDENCE_STEPS, 10, 0);
    expect(result).toBeDefined();
    expect(result!.status).not.toBe("failed");
    // pendingGuidance.evidenceGap should be set
    expect((result!.pendingGuidance as any)?.evidenceGap).toContain("$3,500");
    // evidenceGroundingDone flag set to prevent repeat fires
    expect(result!.meta.evidenceGroundingDone).toBe(true);
    // iteration incremented
    expect(result!.iteration).toBe(2);
  });

  it("returns undefined on iteration 0 (no prior tool results)", () => {
    const state = makeState({ iteration: 0 });
    const result = guardEvidenceGrounding(state, "ETH $3,500.00", EVIDENCE_STEPS, 10, 0);
    expect(result).toBeUndefined();
  });

  it("returns undefined when evidenceGroundingDone is already set (fires at most once)", () => {
    const state = makeState({ meta: { maxIterations: 10, evidenceGroundingDone: true } as any });
    const result = guardEvidenceGrounding(state, "ETH $3,500.00", EVIDENCE_STEPS, 10, 0);
    expect(result).toBeUndefined();
  });

  it("prefers extractedFact fields over raw observation content", () => {
    const stepsWithFacts: readonly ReasoningStep[] = [
      obsStep("Some very long raw content that buries the real figures", "web-search", "$71,535.42"),
      obsStep("More raw content", "web-search", "$2,208.24"),
    ];
    const state = makeState();
    // These figures come from extractedFact, not raw content — should pass
    const output = "BTC is $71,535.42 and ETH is $2,208.24.";
    const result = guardEvidenceGrounding(state, output, stepsWithFacts, 10, 0);
    expect(result).toBeUndefined();
  });

  it("redirects ungrounded claim even when extractedFacts exist", () => {
    const stepsWithFacts: readonly ReasoningStep[] = [
      // extractedFact must be >= 20 chars to be used as corpus
      obsStep("Long raw observation content that is not used", "web-search", "BTC price: $71,535.42 USD per Yahoo Finance"),
    ];
    const state = makeState();
    const output = "BTC is $68,000.00."; // not in extractedFact corpus
    const result = guardEvidenceGrounding(state, output, stepsWithFacts, 10, 0);
    expect(result).toBeDefined();
    expect((result!.pendingGuidance as any)?.evidenceGap).toContain("$68,000");
  });
});
