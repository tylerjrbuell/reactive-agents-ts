// packages/reasoning/tests/assessment/requirement-progress.test.ts
import { describe, it, expect } from "bun:test";
import { assess, MAX_ESCALATION_LEVEL } from "../../src/kernel/assessment/assess.js";
import { appendEntry, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { compileRunContract } from "../../src/kernel/contract/run-contract.js";

const budget = { iteration: 3, maxIterations: 20, tokensUsed: 0, costUsd: 0 };

describe("assess — requirementProgress (FM-17 layer 2)", () => {
  it("stallCount grows across consecutive iterations with a truncated result and no other progress", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 2, truncatedRefs: ["res_b"] });
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 3, truncatedRefs: ["res_c"] });
    const result = assess(contract, ledger, budget);
    const progress = result.requirementProgress.get("answer");
    expect(progress?.stallCount).toBe(3);
  });

  it("stallCount is 0 for a requirement with no enumeration hint", () => {
    const contract = compileRunContract("What is the capital of France?");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    const result = assess(contract, ledger, { ...budget, iteration: 1 });
    expect(result.requirementProgress.get("answer")).toBeUndefined();
  });

  it("stallCount resets to 0 on an iteration with no truncation", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    // iteration 2: no result-truncated entry — the model saw everything that turn.
    const result = assess(contract, ledger, { ...budget, iteration: 2 });
    expect(result.requirementProgress.get("answer")?.stallCount).toBe(0);
  });

  // ── refEscalation — the I2 hysteresis latch ────────────────────────────────

  it("refEscalation does NOT reset when stallCount does (finding I2)", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 1, truncatedRefs: ["res_a"] });
    // iteration 2 records nothing: res_a rendered in FULL because iteration 1's
    // escalation worked. A trailing-run counter reads that as "no stall" and
    // would re-clip res_a next turn, re-truncating it — the flip-flop.
    const result = assess(contract, ledger, { ...budget, iteration: 2 });
    const progress = result.requirementProgress.get("answer");
    expect(progress?.stallCount).toBe(0);
    expect(progress?.refEscalation.get("res_a")).toBe(1);
  });

  it("refEscalation counts distinct truncated iterations per ref and caps", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    for (let i = 1; i <= 7; i++) {
      ledger = appendEntry(ledger, { kind: "result-truncated", iteration: i, truncatedRefs: ["res_a"] });
    }
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 7, truncatedRefs: ["res_b"] });
    const progress = assess(contract, ledger, { ...budget, iteration: 7 }).requirementProgress.get("answer");
    expect(progress?.refEscalation.get("res_a")).toBe(MAX_ESCALATION_LEVEL);
    expect(progress?.refEscalation.get("res_b")).toBe(1);
    // A ref nobody truncated is absent — the C2 membership invariant.
    expect(progress?.refEscalation.get("res_never")).toBeUndefined();
  });

  it("ignores truncation facts stamped AFTER the assessed iteration", () => {
    const contract = compileRunContract("Find and list all the episode names for season 1.");
    let ledger: RunLedger = [];
    ledger = appendEntry(ledger, { kind: "result-truncated", iteration: 9, truncatedRefs: ["res_future"] });
    const progress = assess(contract, ledger, { ...budget, iteration: 2 }).requirementProgress.get("answer");
    expect(progress?.refEscalation.get("res_future")).toBeUndefined();
  });
});
