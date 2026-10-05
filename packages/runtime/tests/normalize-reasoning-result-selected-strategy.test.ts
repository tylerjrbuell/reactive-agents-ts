// Run: bun test packages/runtime/tests/normalize-reasoning-result-selected-strategy.test.ts --timeout 15000
//
// DEBT-REGISTER §3 class ("two types describing one slot"): `normalizeReasoningResult`
// (engine/util.ts) declares `selectedStrategy?: string` on
// ExecutionReasoningResult["metadata"] (util.ts:308) but the whitelist rebuild
// never COPIED it. Consequence: the adaptive strategy's
// `metadata.selectedStrategy = "<sub-strategy>"` (set so the UI/API can report
// what actually ran) is silently dropped at the normalization boundary, so
// `reasoning-think.ts:431` (`result.metadata?.selectedStrategy ?? result.strategy`)
// always falls through to "adaptive", and `AgentResult.metadata.strategyUsed`
// reports the router name instead of the dispatched sub-strategy.
//
// RED-ON-CUT: delete the `selectedStrategy:` copy in `normalizeReasoningResult`
// and the first test fails: selectedStrategy comes back undefined.
//
// Also pins the whitelist semantics: an unknown key must NOT survive the
// rebuild (fixing this field must not turn the rebuild into a spread).
import { describe, it, expect } from "bun:test";
import { normalizeReasoningResult } from "../src/engine/util.js";

describe("selectedStrategy crosses the normalizeReasoningResult boundary", () => {
  it("copies metadata.selectedStrategy through the whitelist rebuild", () => {
    const normalized = normalizeReasoningResult({
      output: "x",
      status: "completed",
      strategy: "adaptive",
      metadata: {
        cost: 0,
        tokensUsed: 0,
        stepsCount: 0,
        selectedStrategy: "plan-execute-reflect",
      },
    });

    // The assertion that was FALSE before this fix: undefined, not the
    // sub-strategy name.
    expect(normalized?.metadata.selectedStrategy).toBe("plan-execute-reflect");
  });

  it("degrades a non-string selectedStrategy to undefined (defensive guard)", () => {
    // Same contract as terminatedBy/rawTerminatedBy: malformed input must not
    // pass through to consumers that treat the field as a strategy name.
    const normalized = normalizeReasoningResult({
      output: "x",
      status: "completed",
      metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, selectedStrategy: 42 },
    });

    expect(normalized).toBeDefined();
    expect(normalized?.metadata.selectedStrategy).toBeUndefined();
  });

  it("still strips unknown metadata keys, the rebuild stays a whitelist", () => {
    const normalized = normalizeReasoningResult({
      output: "x",
      status: "completed",
      metadata: {
        cost: 0,
        tokensUsed: 0,
        stepsCount: 0,
        selectedStrategy: "reactive",
        someUnlistedFutureField: "should not survive",
      },
    });

    expect(normalized?.metadata.selectedStrategy).toBe("reactive");
    const md = normalized?.metadata as Record<string, unknown>;
    expect(md.someUnlistedFutureField).toBeUndefined();
  });
});
