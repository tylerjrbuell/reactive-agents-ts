// packages/reasoning/tests/assessment/requirement-progress.test.ts
import { describe, it, expect } from "bun:test";
import { assess } from "../../src/kernel/assessment/assess.js";
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
});
