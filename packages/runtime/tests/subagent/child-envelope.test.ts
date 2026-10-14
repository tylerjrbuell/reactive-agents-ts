// Run: bun test packages/runtime/tests/subagent/child-envelope.test.ts --timeout 15000
//
// Wave 5.3 — the executor stamps the child's completion envelope off its
// engine result (guarded reads, never a cast): top-level terminatedBy/success
// plus the FOLD-forwarded honesty markers on metadata. The parent terminal
// joins these worst-of, so a partial child caps a completed parent claim.
//
// RED-ON-CUT: read `result.metadata.completionEnvelope` (the object that does
// not exist) instead of deriving, and the partial/abstained arms go dark.
import { describe, expect, it } from "bun:test";
import type { TaskResult } from "@reactive-agents/core";
import { childCompletionEnvelope } from "../../src/builder/build-effect/sub-agent-executor.js";

// Single `as unknown as` site in this file (cast-ceiling ratchet): the engine
// result carries honesty markers as unknown keys that core's ResultMetadata
// schema does not declare, so literals narrow through this one helper.
const mkChildResult = (overrides: {
  success: boolean;
  terminatedBy: string;
  metadata: Record<string, unknown>;
}): TaskResult =>
  ({
    taskId: "t1",
    agentId: "a1",
    output: "done",
    completedAt: new Date(),
    ...overrides,
  }) as unknown as TaskResult;

describe("childCompletionEnvelope", () => {
  it("completed child with clean metadata => completed", () => {
    const r = childCompletionEnvelope(
      mkChildResult({ success: true, terminatedBy: "final_answer", metadata: { tokensUsed: 10 } }),
    );
    expect(r.completionStatus).toBe("completed");
  });

  it("outstanding criteria => partial (with markers forwarded)", () => {
    const r = childCompletionEnvelope(
      mkChildResult({
        success: false,
        terminatedBy: "end_turn",
        metadata: { tokensUsed: 10, outstandingCriteria: ["answer"], verificationWarning: "reqs open" },
      }),
    );
    expect(r.completionStatus).toBe("partial");
    expect(r.verificationWarning).toBe("reqs open");
  });

  it("abstained terminal => abstained even on success", () => {
    const r = childCompletionEnvelope(
      mkChildResult({ success: false, terminatedBy: "abstained", metadata: { tokensUsed: 1 } }),
    );
    expect(r.completionStatus).toBe("abstained");
  });

  it("failed child with no markers => failed", () => {
    const r = childCompletionEnvelope(
      mkChildResult({ success: false, terminatedBy: "llm_error", metadata: { tokensUsed: 1 } }),
    );
    expect(r.completionStatus).toBe("failed");
  });

  it("budget-terminal marker => partial", () => {
    const r = childCompletionEnvelope(
      mkChildResult({
        success: false,
        terminatedBy: "max_iterations",
        metadata: { tokensUsed: 5, budgetTerminalPartial: true },
      }),
    );
    expect(r.completionStatus).toBe("partial");
    expect(r.budgetTerminalPartial).toBe(true);
  });
});
