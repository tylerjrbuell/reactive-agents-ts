// deliverable-report.test.ts — B2 acceptance test #4 (the sweep's rw-8 witness).
//
// A run that produces 1 of 3 required files must terminate with the 2 MISSING
// deliverables NAMED in the receipt. This is the deterministic form of the
// acceptance: build the state (1 of 3 artifacts) from a fixture and assert the
// contract × step-scan report + the TrustReceipt name the two missing files.
import { describe, expect, it } from "bun:test";
import { computeTrustReceipt } from "@reactive-agents/core";
import { compileRunContract } from "../../../src/kernel/contract/run-contract.js";
import { computeDeliverableReport } from "../../../src/kernel/contract/deliverable-report.js";
import type { ObservationResult, ReasoningStep } from "../../../src/types/index.js";

// rw-8 declares three files: types.ts, generate.ts, validate.ts.
const RW8_PROMPT = `Phase 2: Write a TypeScript type definition file (types.ts) for User, Order, Product
Phase 3: Write a data generator (generate.ts) that creates 5 sample records of each type
Phase 4: Write a validator (validate.ts) that checks all constraints are met`;

/** A completed successful write of `path` (action + linked observation). */
function writeSteps(path: string, n: number): ReasoningStep[] {
  return [
    {
      id: `act-${n}` as ReasoningStep["id"],
      type: "action",
      content: `file-write(${path})`,
      timestamp: new Date(),
      metadata: { toolCall: { id: `tc-${n}`, name: "file-write", arguments: { path, content: "x" } } },
    },
    {
      id: `obs-${n}` as ReasoningStep["id"],
      type: "observation",
      content: "ok",
      timestamp: new Date(),
      metadata: {
        toolCallId: `tc-${n}`,
        observationResult: {
          success: true,
          toolName: "file-write",
          displayText: "ok",
          category: "file-write",
          resultKind: "side-effect",
          preserveOnCompaction: true,
          trustLevel: "untrusted",
        } as ObservationResult,
      },
    },
  ];
}

describe("computeDeliverableReport — rw-8 partial (1 of 3)", () => {
  it("marks the written file produced and the two others missing", () => {
    const contract = compileRunContract(RW8_PROMPT);
    // Only types.ts was actually written.
    const steps = writeSteps("./types.ts", 1);
    const report = computeDeliverableReport(contract, steps, "");

    expect(report).toHaveLength(3);
    const byProduced = (p: boolean) => report.filter((d) => d.produced === p).map((d) => d.spec);
    expect(byProduced(true)).toEqual(["produce the file ./types.ts"]);
    expect(byProduced(false).sort()).toEqual([
      "produce the file ./generate.ts",
      "produce the file ./validate.ts",
    ]);
  });

  it("the TrustReceipt NAMES the two missing deliverables (acceptance #4)", () => {
    const contract = compileRunContract(RW8_PROMPT);
    const steps = writeSteps("./types.ts", 1);
    const deliverables = computeDeliverableReport(contract, steps, "");

    const receipt = computeTrustReceipt({
      toolCalls: [{ name: "file-write", ok: true }],
      terminatedBy: "final_answer_tool",
      goalAchieved: true,
      abstained: false,
      success: true,
      modelId: "qwen3:14b",
      deliverables,
      now: 1000,
    });

    expect(receipt.deliverables).toHaveLength(3);
    const missing = (receipt.deliverables ?? []).filter((d) => !d.produced).map((d) => d.spec);
    expect(missing).toEqual([
      "produce the file ./generate.ts",
      "produce the file ./validate.ts",
    ]);
  });

  it("all three produced → every deliverable produced (full-completion control)", () => {
    const contract = compileRunContract(RW8_PROMPT);
    const steps = [
      ...writeSteps("./types.ts", 1),
      ...writeSteps("./generate.ts", 2),
      ...writeSteps("./validate.ts", 3),
    ];
    const report = computeDeliverableReport(contract, steps, "");
    expect(report.every((d) => d.produced)).toBe(true);
  });

  it("no declared deliverables → empty report (pure Q&A keeps receipt clean)", () => {
    const contract = compileRunContract("What is the capital of France?");
    expect(computeDeliverableReport(contract, [], "Paris")).toEqual([]);
  });
});
