import { describe, test, expect } from "bun:test";
import { computeTrustReceipt } from "../src/types/receipt.js";

const base = { terminatedBy: "final_answer_tool", goalAchieved: true, abstained: false, success: true, modelId: "qwen3:4b", now: 1000 };

describe("computeTrustReceipt", () => {
  test("tool-grounded when a substantive call succeeded", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [{ name: "calculator", ok: true }] });
    expect(r.verdict).toBe("tool-grounded");
    expect(r.toolsUsed).toEqual(["calculator"]);
    expect(r.toolCallStats).toEqual({ ok: 1, failed: 0 });
  });
  test("ungrounded when zero tool calls", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [] });
    expect(r.verdict).toBe("ungrounded");
  });
  test("partially-grounded when all calls failed", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [{ name: "web", ok: false }] });
    expect(r.verdict).toBe("partially-grounded");
  });
  test("abstained wins over everything", () => {
    const r = computeTrustReceipt({ ...base, abstained: true, toolCalls: [{ name: "x", ok: true }] });
    expect(r.verdict).toBe("abstained");
  });
  test("verifier pass raises confidence", () => {
    const r = computeTrustReceipt({ ...base, verifierVerdict: "pass", toolCalls: [{ name: "calculator", ok: true }] });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
