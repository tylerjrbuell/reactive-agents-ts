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

  // ── B2 (meta-loop 4a): deliverables[] passthrough ──
  test("deliverables absent by default (byte-identical to v1)", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [{ name: "calculator", ok: true }] });
    expect(r.deliverables).toBeUndefined();
    expect("deliverables" in r).toBe(false);
  });
  test("empty deliverables array stays absent", () => {
    const r = computeTrustReceipt({ ...base, toolCalls: [], deliverables: [] });
    expect(r.deliverables).toBeUndefined();
  });
  test("names missing deliverables verbatim (rw-8 partial: 1 of 3)", () => {
    const r = computeTrustReceipt({
      ...base,
      toolCalls: [{ name: "file-write", ok: true }],
      deliverables: [
        { spec: "produce the file ./report.md", produced: true },
        { spec: "produce the file ./findings.json", produced: false },
        { spec: "produce the file ./sources.md", produced: false },
      ],
    });
    expect(r.deliverables).toHaveLength(3);
    const missing = (r.deliverables ?? []).filter((d) => !d.produced).map((d) => d.spec);
    expect(missing).toEqual([
      "produce the file ./findings.json",
      "produce the file ./sources.md",
    ]);
  });
});
