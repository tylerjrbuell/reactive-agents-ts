import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { finalizeStrategyResult } from "./finalize-result.js";
import type { JudgedReasoningResult } from "./finalize-result.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../envelope/run-envelope.js";
import type { ReasoningResult } from "../../../types/index.js";

const baseParams = {
  strategy: "reactive" as const,
  steps: [],
  output: "The answer is 42.",
  status: "completed" as const,
  start: 0,
  totalTokens: 10,
  totalCost: 0,
};

describe("finalizeStrategyResult — the only mint of a judged result", () => {
  it("produces a result identical to buildStrategyResult's shape, plus a verdict record", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult(baseParams)),
    );
    expect(r.status).toBe("completed");
    expect(r.output).toBe("The answer is 42.");
    // Judgment is INERT in this task: computed + recorded, never enforced.
    expect(r.metadata.verdict).toBeDefined();
    expect(r.metadata.verdict?.enforced).toBe(false);
  });

  it("a JudgedReasoningResult is assignable to ReasoningResult (consumers unchanged)", async () => {
    const r: JudgedReasoningResult = await Effect.runPromise(
      provideTestEnvelope(finalizeStrategyResult(baseParams)),
    );
    const plain: ReasoningResult = r; // must compile
    expect(plain.strategy).toBe("reactive");
  });

  it("witness: a plain ReasoningResult is NOT a JudgedReasoningResult", () => {
    const plain: ReasoningResult = {
      strategy: "reactive",
      steps: [],
      output: "x",
      metadata: { duration: 0, tokensUsed: 0, cost: 0, stepsCount: 0, confidence: 1 },
      status: "completed",
    };
    // @ts-expect-error — the brand is unexported; only finalizeStrategyResult mints it.
    const judged: JudgedReasoningResult = plain;
    expect(judged).toBeDefined(); // runtime no-op; the assertion is the compile error above
  });

  it("records the declared repair gap when the strategy reports no per-iteration repair", async () => {
    const r = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({ ...baseParams, repairCapabilities: { perIteration: false } }),
        buildRunEnvelope({ fabricationGuard: "block" }),
      ),
    );
    expect(r.metadata.verdict?.repairGaps).toEqual(["per-iteration"]);
  });
});
