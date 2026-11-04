import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCause, loadTrace, tallyCauses } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";

// Grader-in-trace (2026-11-03): the deterministic grader verdict rides the trace
// as `eval-graded`, and a clean-ending run whose grade failed is `wrong-answer`.

let seq = 0;
const base = (iter = 0) => ({ runId: "r1", iter, seq: seq++, timestamp: 1000 + seq });
// boundary: one cast site for partial trace-event fixtures; the cause reader ignores absent fields
const mk = (e: Record<string, unknown>): TraceEvent => e as unknown as TraceEvent;

const started = () => mk({ ...base(-1), kind: "run-started", task: "t", model: "m", provider: "ollama", config: {} });
const completedEv = (status: "success" | "failure", extra: Record<string, unknown> = {}) =>
  mk({ ...base(-1), kind: "run-completed", status, totalTokens: 1, totalCostUsd: 0, durationMs: 1, ...extra });
const guard = (g: string, outcome: string, reason: string, metadata?: Record<string, unknown>) =>
  mk({ ...base(1), kind: "guard-fired", guard: g, outcome, reason, ...(metadata ? { metadata } : {}) });
const terminal = (status: string, terminatedBy: string, authority = "model-final") =>
  guard("terminal_decision", "terminate", terminatedBy, { terminatedBy, status, authority });
const graded = (passed: boolean, checks: { name: string; passed: boolean }[], score = passed ? 1 : 0.5) =>
  mk({
    ...base(-1), kind: "eval-graded", score, passed, threshold: 1, checks,
    grader: "verifiable:bun hidden-check.ts", taskId: "t1", source: "trace-regrade",
  });
const trace = (events: TraceEvent[]): Trace => ({ runId: "r1", events });

const cleanSuccess = (): TraceEvent[] => [
  started(),
  guard("deliverable_decision", "pass", "verified"),
  terminal("done", "end_turn"),
  completedEv("success", { terminatedBy: "end_turn", outcome: { authority: "model-final", status: "completed", success: true } }),
];

describe("eval-graded — loadTrace keeps the line", () => {
  it("an eval-graded JSONL line survives loadTrace (REQUIRED_FIELDS_BY_KIND + union member)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-graded-"));
    try {
      const p = join(dir, "r1.jsonl");
      const lines = [...cleanSuccess(), graded(false, [{ name: "mean is right", passed: false }])];
      writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
      const t = await loadTrace(p);
      const g = t.events.find((e) => e.kind === "eval-graded");
      expect(g).toBeDefined();
      expect(g).toMatchObject({ score: 0.5, passed: false, grader: "verifiable:bun hidden-check.ts", taskId: "t1" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an eval-graded line missing a required field (checks) is dropped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-graded-"));
    try {
      const p = join(dir, "r1.jsonl");
      const bad = { runId: "r1", iter: -1, seq: 99, timestamp: 1, kind: "eval-graded", score: 0, passed: false, grader: "regex", taskId: "t1" };
      writeFileSync(p, JSON.stringify(bad) + "\n", "utf8");
      expect((await loadTrace(p)).events).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("analyzeCause — wrong-answer (grader-in-trace)", () => {
  it("clean ending + failed grade => wrong-answer, decisive, subCause = first failed check, evidence names failed checks", () => {
    const c = analyzeCause(trace([
      ...cleanSuccess(),
      graded(false, [
        { name: "file exists", passed: true },
        { name: "mean.txt within tolerance", passed: false },
        { name: "median correct", passed: false },
      ]),
    ]));
    expect(c).toMatchObject({ cause: "wrong-answer", subCause: "mean.txt within tolerance", confidence: "decisive", outcomeStatus: "success" });
    expect(c.missing).toEqual([]);
    expect(c.evidence[0]?.eventKind).toBe("eval-graded");
    expect(c.evidence[0]?.detail).toContain("score=0.500/1");
    expect(c.evidence[0]?.detail).toContain("mean.txt within tolerance, median correct");
  });

  it("red-on-cut: without the eval-graded event the same run is none", () => {
    expect(analyzeCause(trace(cleanSuccess())).cause).toBe("none");
  });

  it("a passing grade never changes the label (none stays none)", () => {
    const c = analyzeCause(trace([...cleanSuccess(), graded(true, [{ name: "ok", passed: true }])]));
    expect(c.cause).toBe("none");
  });

  it("success-with-warning + failed grade => wrong-answer that keeps the warning evidence", () => {
    const c = analyzeCause(trace([
      started(),
      guard("deliverable_decision", "pass", "advisory-softfail"),
      terminal("done", "end_turn"),
      completedEv("success", { terminatedBy: "end_turn", outcome: { verifierVerdict: { verified: false, failedChecks: ["chk-x"] } } }),
      graded(false, [{ name: "answer correct", passed: false }], 0),
    ]));
    expect(c).toMatchObject({ cause: "wrong-answer", subCause: "answer correct", confidence: "decisive" });
    expect(c.evidence.some((e) => e.detail.includes("failedChecks=chk-x"))).toBe(true);
  });

  it("success-with-warning + passing grade stays success-with-warning", () => {
    const c = analyzeCause(trace([
      started(),
      guard("deliverable_decision", "pass", "advisory-softfail"),
      terminal("done", "end_turn"),
      completedEv("success", { terminatedBy: "end_turn", outcome: { verifierVerdict: { verified: false, failedChecks: ["chk-x"] } } }),
      graded(true, [], 1),
    ]));
    expect(c.cause).toBe("success-with-warning");
  });

  it("a failed grade with no named checks is still wrong-answer, without a subCause", () => {
    const c = analyzeCause(trace([...cleanSuccess(), graded(false, [], 0)]));
    expect(c.cause).toBe("wrong-answer");
    expect(c.subCause).toBeUndefined();
  });

  it("the last eval-graded wins (a later passing regrade clears an earlier failure)", () => {
    const c = analyzeCause(trace([...cleanSuccess(), graded(false, [{ name: "x", passed: false }]), graded(true, [])]));
    expect(c.cause).toBe("none");
  });

  it("earlier rules still win: provider-error with a failed grade stays provider-error", () => {
    const c = analyzeCause(trace([
      started(), terminal("failed", "llm_error", "error"),
      completedEv("failure", { terminatedBy: "llm_error", error: "Your credit balance is too low" }),
      graded(false, [{ name: "x", passed: false }], 0),
    ]));
    expect(c.cause).toBe("provider-error");
  });

  it("earlier rules still win: terminal-mislabel with a failed grade stays terminal-mislabel", () => {
    const c = analyzeCause(trace([
      started(), guard("deliverable_decision", "block", "unverified", { accepted: false }),
      terminal("done", "end_turn"), completedEv("success", { terminatedBy: "end_turn" }),
      graded(false, [{ name: "x", passed: false }], 0),
    ]));
    expect(c.cause).toBe("terminal-mislabel");
  });

  it("a failed grade on a non-success residual does not relabel it (unexplained stays unexplained)", () => {
    const c = analyzeCause(trace([
      started(), terminal("failed", "end_turn"), completedEv("failure", { terminatedBy: "end_turn" }),
      graded(false, [{ name: "x", passed: false }], 0),
    ]));
    expect(c.cause).toBe("unexplained");
  });

  it("tallyCauses counts wrong-answer like any other cause", () => {
    const wrong = analyzeCause(trace([...cleanSuccess(), graded(false, [{ name: "x", passed: false }], 0)]));
    const t = tallyCauses([wrong]);
    expect(t.byCause["wrong-answer"]).toBe(1);
    expect(t.byCauseAndStatus["wrong-answer|success"]).toBe(1);
  });
});
