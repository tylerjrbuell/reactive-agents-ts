import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { finalizeStrategyResult } from "./finalize-result.js";
import type { JudgedReasoningResult } from "./finalize-result.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../envelope/run-envelope.js";
import type { ReasoningResult } from "../../../types/index.js";
import { makeStep } from "./step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";

// @ts-expect-error — the brand symbol must stay module-private; exporting it
// would defeat the mint (a direct type import must fail to compile, not just
// the derived-type witness below).
import type { Judged } from "./finalize-result.js";

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

  describe("groundedOnRequired — the only computed branch (Fix 3)", () => {
    it("requiredTools declared + a successful matching required tool call ⇒ groundedOnRequired: true", async () => {
      const groundedStep = makeStep(
        "observation",
        "read the config file",
        { observationResult: makeObservationResult("file-read", true, "contents of config") },
      );
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            steps: [groundedStep],
            requiredTools: ["file-read"],
          }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(true);
      // A grounded run has nothing to flag as failed.
      expect(r.metadata.verdict?.failed).toEqual([]);
    });

    it("requiredTools declared + no successful matching step ⇒ groundedOnRequired: false", async () => {
      const unrelatedStep = makeStep(
        "observation",
        "listed the directory",
        { observationResult: makeObservationResult("list-directory", true, "a.txt, b.txt") },
      );
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            steps: [unrelatedStep],
            requiredTools: ["file-read"],
          }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
    });
  });

  describe("Task-3 inertness gate — a HOT config must not enforce anything yet (Fix 4)", () => {
    it("ungrounded required tool + fabricationGuard configured still leaves enforced:false and status/output untouched", async () => {
      // HOT: requiredTools declared, nothing satisfies them, AND a guard is
      // configured — envelope.policy.fabricationGuard !== undefined, so
      // `failed` DOES get "grounding-on-required" pushed. This is exactly the
      // condition a later enforcement task (Task 8) will flip. Until then,
      // the mint must remain a pure recorder: enforced stays false and the
      // caller's status/output ride through unchanged. If this test ever goes
      // green for the wrong reason (enforcement shipped without updating it),
      // that is the signal to rewrite it as a red-on-cut for enforcement, not
      // delete it.
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            steps: [],
            requiredTools: ["file-read"],
          }),
          buildRunEnvelope({ fabricationGuard: "block" }),
        ),
      );
      expect(r.metadata.verdict?.groundedOnRequired).toBe(false);
      expect(r.metadata.verdict?.failed).toEqual(["grounding-on-required"]);
      // The inertness invariant itself:
      expect(r.metadata.verdict?.enforced).toBe(false);
      expect(r.status).toBe(baseParams.status); // unchanged from what was passed in
      expect(r.output).toBe(baseParams.output); // unchanged from what was passed in
    });
  });

  describe("wrapped invariants must survive the mint (Fix 5)", () => {
    it("HS-106 output/status coherence: empty output + status:'completed' comes back 'failed'", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            output: "",
            status: "completed",
          }),
        ),
      );
      expect(r.status).toBe("failed");
    });

    it("pause-rail forwarding: a pause carried via `pause` surfaces awaitingApprovalFor on metadata", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            output: "Run paused — awaiting human approval.",
            pause: {
              reason: "awaiting-approval",
              output: "Run paused — awaiting human approval.",
              awaitingApprovalFor: { gateId: "g1", toolName: "file-write", args: {} },
            },
          }),
        ),
      );
      const meta = r.metadata as {
        awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown };
      };
      expect(meta.awaitingApprovalFor).toEqual({
        gateId: "g1",
        toolName: "file-write",
        args: {},
      });
    });

    it("pause-rail forwarding: a pause carried via `kernelMeta` surfaces awaitingInteractionFor on metadata", async () => {
      const r = await Effect.runPromise(
        provideTestEnvelope(
          finalizeStrategyResult({
            ...baseParams,
            output: "Run paused — awaiting user input.",
            kernelMeta: {
              awaitingInteractionFor: {
                interactionId: "i1",
                kind: "form",
                prompt: "Pick one",
                schemaJson: "{}",
              },
            },
          }),
        ),
      );
      const meta = r.metadata as {
        awaitingInteractionFor?: {
          interactionId: string;
          kind: string;
          prompt: string;
          schemaJson: string;
        };
      };
      expect(meta.awaitingInteractionFor).toEqual({
        interactionId: "i1",
        kind: "form",
        prompt: "Pick one",
        schemaJson: "{}",
      });
    });
  });
});
