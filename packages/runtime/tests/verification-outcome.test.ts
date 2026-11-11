// Run: bun test packages/runtime/tests/verification-outcome.test.ts --timeout 15000
import { describe, test, expect } from "bun:test";
import { applyVerificationOutcome } from "../src/engine/finalize/verification-outcome.js";

describe("F10 — applyVerificationOutcome", () => {
  test("proceed (no flags) leaves output and success untouched", () => {
    const r = applyVerificationOutcome("the answer", true, {});
    expect(r.output).toBe("the answer");
    expect(r.success).toBe(true);
    expect(r.blocked).toBe(false);
  });

  test("block withholds the answer and fails the run", () => {
    const r = applyVerificationOutcome("the risky answer", true, {
      verificationBlocked: { reason: "low factuality score" },
    });
    expect(r.success).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.output).not.toBe("the risky answer");
    // Owner decision 2026-11-10: the withheld answer is not replaced with
    // harness text; output is empty and the cause rides `error`.
    expect(r.output).toBe("");
    expect(String(r.error)).toContain("Verification rejected the response");
    expect(r.error).toContain("low factuality score");
  });

  // Owner rule 2026-11-10: the harness never writes text into output. The
  // verifier's note rides `note`; the answer ships byte-identical.
  // RED-ON-CUT: prepend the annotation to output in applyVerificationOutcome.
  test("annotate keeps the answer byte-identical and carries the note on `note`", () => {
    const r = applyVerificationOutcome("the answer", true, {
      verificationAnnotation: "failed verification",
    });
    expect(r.success).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.output).toBe("the answer");
    expect(r.note).toBe("failed verification");
  });

  test("no onReject mode writes harness text into a non-empty output", () => {
    const answer = "the model's answer";
    const proceed = applyVerificationOutcome(answer, true, {});
    const annotate = applyVerificationOutcome(answer, true, { verificationAnnotation: "note" });
    const block = applyVerificationOutcome(answer, true, { verificationBlocked: { reason: "r" } });
    expect(proceed.output).toBe(answer);
    expect(annotate.output).toBe(answer);
    // block withholds: empty, never a harness sentence.
    expect(block.output).toBe("");
    expect(proceed.note).toBeUndefined();
    expect(block.note).toBeUndefined();
  });
});
