import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import {
  analyzeCause,
  attributeFailure,
  causeDescription,
  causeNextActions,
  loadTrace,
  parseTrace,
  renderCause,
  runSegments,
} from "../src/index.js";
import type { Trace } from "../src/index.js";

// Instrument faults from the strategy-substrate conformance audit
// (wiki/Research/Harness-Reports/2026-11-18-strategy-substrate-conformance.md, I1-I3).
// Fixtures are minimal, scrubbed extracts of the audit's Cortex traces: only the
// events these rules read, no task text, tool output or answer text.

const FIX = join(import.meta.dir, "fixtures");
const load = (name: string): Promise<Trace> => loadTrace(join(FIX, name));

const line = (o: Record<string, unknown>): string => JSON.stringify(o);
const synthetic = (tail: Record<string, unknown>[]): Trace =>
  parseTrace(
    [
      line({ kind: "run-started", runId: "s1", iter: -1, seq: 0, timestamp: 1, task: "t", model: "m", provider: "ollama", config: {} }),
      ...tail.map((t, i) => line({ runId: "s1", iter: -1, seq: i + 1, timestamp: 2 + i, ...t })),
    ].join("\n"),
  );

describe("I1: a strategy-body error is a decisive strategy-error cause", () => {
  it("code-action refusing the approval policy reads strategy-error/config-refused (no model call, no tokens)", async () => {
    const c = analyzeCause(await load("conformance-i1-strategy-config-refused.jsonl"));
    expect(c.cause).toBe("strategy-error");
    expect(c.subCause).toBe("config-refused");
    expect(c.confidence).toBe("decisive");
    expect(c.evidence[0]?.detail).toContain("code-action");
    expect(causeDescription(c.cause, c.subCause)).toContain("refused the run's configuration");
    expect(causeNextActions(c)[0]).toContain("change the strategy or the conflicting option");
  });

  it("reflexion whose synthesis fallback failed reads strategy-error/synthesis-failed, not the inner pass's cap", async () => {
    const c = analyzeCause(await load("conformance-i1-strategy-synthesis-failed.jsonl"));
    expect(c.cause).toBe("strategy-error");
    expect(c.subCause).toBe("synthesis-failed");
    expect(c.confidence).toBe("decisive");
  });

  it("after G2: a strategy-error terminal authority alone is enough", () => {
    const c = analyzeCause(synthetic([
      { kind: "guard-fired", iter: 2, guard: "terminal_decision", outcome: "terminate", reason: "strategy_error", metadata: { terminatedBy: "strategy_error", status: "failed", authority: "strategy-error" } },
      { kind: "run-completed", status: "failure", terminatedBy: "strategy_error", totalTokens: 40, totalCostUsd: 0, durationMs: 1, outcome: { authority: "strategy-error", status: "failed", success: false } },
    ]));
    expect(c.cause).toBe("strategy-error");
    expect(c.subCause).toBe("body-error");
    expect(c.confidence).toBe("decisive");
  });

  it("after G2 with the generic error authority: the strategy failure text still wins over provider-error", () => {
    const c = analyzeCause(synthetic([
      { kind: "guard-fired", iter: 2, guard: "terminal_decision", outcome: "terminate", reason: "strategy_error", metadata: { terminatedBy: "strategy_error", status: "failed", authority: "error" } },
      { kind: "run-completed", status: "failure", terminatedBy: "strategy_error", error: "Strategy execution failed (tree-of-thought): no branch scored", totalTokens: 40, totalCostUsd: 0, durationMs: 1 },
    ]));
    expect(c.cause).toBe("strategy-error");
  });

  it("a strategy body that failed on a model call is a probable provider-error", () => {
    const c = analyzeCause(synthetic([
      { kind: "run-completed", status: "failure", terminatedBy: "end_turn", error: "Strategy execution failed (blueprint): Plan generation failed: LLM call failed: ollama request failed: Unable to connect", totalTokens: 0, totalCostUsd: 0, durationMs: 1 },
    ]));
    expect(c.cause).toBe("provider-error");
    expect(c.confidence).toBe("probable");
  });

  it("a provider error wrapped as a strategy failure stays provider-error", () => {
    const c = analyzeCause(synthetic([
      { kind: "guard-fired", iter: 0, guard: "terminal_decision", outcome: "terminate", reason: "llm_error", metadata: { terminatedBy: "llm_error", status: "failed", authority: "error" } },
      { kind: "run-completed", status: "failure", terminatedBy: "llm_error", error: "Strategy execution failed (reactive): rate limit exceeded (429)", totalTokens: 0, totalCostUsd: 0, durationMs: 1 },
    ]));
    expect(c.cause).toBe("provider-error");
    expect(c.subCause).toBe("rate");
  });
});

describe("I2: runs that share one runId are split, and the last one is reported", () => {
  it("splits the file at each run-started of its runId", async () => {
    const t = await load("conformance-i2-two-runs-one-runid.jsonl");
    const segs = runSegments(t);
    expect(segs.length).toBe(2);
    expect(segs.every((s) => s.events[0]?.kind === "run-started")).toBe(true);
    expect(segs.reduce((n, s) => n + s.events.length, 0)).toBe(t.events.length);
    // Tool counts belong to their own run, not the sum of both.
    const ends = segs.map((s) => s.events.filter((e) => e.kind === "tool-call-end").length);
    expect(ends[0]! + ends[1]!).toBe(t.events.filter((e) => e.kind === "tool-call-end").length);
    expect(ends[1]).toBeLessThan(ends[0]! + ends[1]!);
  });

  it("analyzeCause covers the last run and says how many share the id", async () => {
    const c = analyzeCause(await load("conformance-i2-two-runs-one-runid.jsonl"));
    expect(c.runSegment).toEqual({ index: 2, count: 2 });
    expect(c.cause).toBe("none");
    expect(renderCause(c)).toContain("2 runs share this runId; this is run 2 of 2 (the last)");
  });

  it("the first run's failure is visible on its own segment", async () => {
    const [first] = runSegments(await load("conformance-i2-two-runs-one-runid.jsonl"));
    const c = analyzeCause(first!);
    expect(c.outcomeStatus).toBe("failure");
    expect(c.cause).toBe("verifier-reject");
    expect(c.runSegment).toBeUndefined();
    expect(attributeFailure(first!).reason).toBe("model:fabrication-vetoed");
  });

  it("attributeFailure reads the last run too, never the first run's veto", async () => {
    const t = await load("conformance-i2-two-runs-one-runid.jsonl");
    const a = attributeFailure(t);
    expect(a).toEqual(attributeFailure(runSegments(t)[1]!));
    expect(a.reason).not.toBe("model:fabrication-vetoed");
  });

  it("a single-run trace comes back unchanged with no segment note", async () => {
    const t = await load("conformance-i1-strategy-config-refused.jsonl");
    expect(runSegments(t)).toEqual([t]);
    expect(analyzeCause(t).runSegment).toBeUndefined();
  });
});

describe("I3: a status override that fails a verified, accepted answer is the cause, not the cap", () => {
  it("names the override as terminal-mislabel/status-override (harness), decisively", async () => {
    const t = await load("conformance-i3-status-override-veto.jsonl");
    const c = analyzeCause(t);
    expect(c.cause).toBe("terminal-mislabel");
    expect(c.subCause).toBe("status-override");
    expect(c.confidence).toBe("decisive");
    expect(c.evidence.map((e) => e.detail).join("\n")).toContain("terminal_status_override reason=envelope-outstanding labelsDisagree=true");
    expect(causeNextActions(c)[0]).toContain("status override");
    const a = attributeFailure(t);
    expect(a.verdict).toBe("harness");
    expect(a.reason).toBe("harness:terminal-mislabel");
  });

  const vetoTail = (deliverableOutcome: string, overrideReason: string, intent = "deliver"): Record<string, unknown>[] => [
    { kind: "guard-fired", iter: 4, guard: "deliverable_decision", outcome: deliverableOutcome, reason: "verified", metadata: { accepted: deliverableOutcome === "pass" } },
    { kind: "guard-fired", iter: 4, guard: "terminal_decision", outcome: "terminate", reason: "done", metadata: { status: "done", finalStatus: "completed", intent, authority: "none-recorded", iterationCap: { counter: "iteration", observed: 4, threshold: 4, capped: true } } },
    { kind: "guard-fired", iter: 4, guard: "terminal_status_override", outcome: "warn", reason: overrideReason, metadata: { labelsDisagree: true, terminalDecisionFinalStatus: "completed", finalStatus: "partial" } },
    { kind: "run-completed", status: "failure", terminatedBy: "end_turn", totalTokens: 10, totalCostUsd: 0, durationMs: 1 },
  ];

  it("a blocked deliverable is not a status-override veto", () => {
    expect(analyzeCause(synthetic(vetoTail("block", "gate-verdict"))).subCause).not.toBe("status-override");
  });

  it("a terminal that did not mean to deliver is not a status-override veto", () => {
    expect(analyzeCause(synthetic(vetoTail("pass", "envelope-outstanding", "fail"))).subCause).not.toBe("status-override");
  });

  it("a contract-coverage override is left to its own rule", () => {
    expect(analyzeCause(synthetic(vetoTail("pass", "contract-coverage"))).subCause).not.toBe("status-override");
  });

  it("the synthetic veto shape itself matches", () => {
    const c = analyzeCause(synthetic(vetoTail("pass", "envelope-outstanding")));
    expect(c.cause).toBe("terminal-mislabel");
    expect(c.subCause).toBe("status-override");
  });
});
