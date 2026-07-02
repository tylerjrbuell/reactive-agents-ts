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
    expect(String(r.output)).toContain("withheld");
    expect(r.error).toContain("low factuality score");
  });

  test("annotate prepends a warning and keeps the answer + success", () => {
    const r = applyVerificationOutcome("the answer", true, {
      verificationAnnotation: "⚠ failed verification",
    });
    expect(r.success).toBe(true);
    expect(r.blocked).toBe(false);
    expect(String(r.output)).toContain("⚠ failed verification");
    expect(String(r.output)).toContain("the answer");
  });
});
