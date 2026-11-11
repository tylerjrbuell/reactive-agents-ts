import { describe, expect, it } from "bun:test";
import { safetyEntriesOf, safetyPlaceLabel, safetySummaryOf, SAFETY_EVENT_TAGS, safetyBodyOf } from "../src/index.js";

let t = 0;
const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload, ts: ++t });

describe("safety entries: what stepped in, in plain words", () => {
  it("reads every listed event tag", () => {
    const samples: Record<string, Record<string, unknown>> = {
      InterventionDispatched: { decisionType: "early-stop", patchKind: "early-stop", cost: { tokensEstimated: 0 } },
      GuardrailViolationDetected: { violations: ["injection"], score: 0.9, blocked: true },
      GuardrailReviewFlagged: { side: "input", dimension: "pii_exposure", probability: 0.6, severity: "medium" },
      GuardrailOutputFlagged: { injection: 0.1, piiExposure: 0.8, toxicity: 0, jailbreakRoleplay: 0, severity: "high" },
      VerifierVerdictEmitted: { verified: false, terminal: true, summary: "no evidence", checks: [] },
      BudgetExhausted: { budgetType: "daily-tokens", limit: 1000, used: 1000 },
      BudgetSignalCollectedEmitted: { status: "warning", tokensUsed: 900, tokenLimit: 1000, costUsd: 0 },
      ContextWindowWarning: { utilizationPct: 91, atRiskSections: ["tool_results"] },
      CalibrationDrift: { modelId: "m", expectedMean: 0.3, observedMean: 0.7, deviationSigma: 2.5 },
      AgentCompleted: { success: false, terminationReason: "budget_exceeded", error: "budget_exceeded: tokens 496 ≥ tokenLimit 400" },
    };
    for (const tag of SAFETY_EVENT_TAGS) expect(safetyBodyOf(tag, samples[tag] ?? {})).toBeDefined();
  });

  it("words each mechanism plainly, with the numbers as the detail", () => {
    expect(safetyBodyOf("GuardrailViolationDetected", { violations: ["injection", "pii"], score: 0.82, blocked: true })).toEqual({
      kind: "guardrail",
      tone: "bad",
      title: "A guardrail blocked the run: injection, pii",
      detail: "Score 0.82",
    });
    expect(safetyBodyOf("InterventionDispatched", { decisionType: "early-stop", patchKind: "early-stop", cost: { tokensEstimated: 120 } })?.title).toBe(
      "The controller stopped the run early",
    );
    expect(safetyBodyOf("InterventionDispatched", { decisionType: "new-thing" })?.title).toBe("The controller applied new thing");
    expect(safetyBodyOf("BudgetExhausted", { budgetType: "daily-tokens", limit: 5000, used: 5012 })).toMatchObject({
      tone: "bad",
      title: "The daily tokens budget ran out",
      detail: "Used 5,012 of 5,000",
    });
    expect(safetyBodyOf("ContextWindowWarning", { utilizationPct: 0.87, atRiskSections: ["tool_results"] })).toMatchObject({
      title: "The context window is 87% full",
      detail: "At risk: tool results",
    });
    expect(safetyBodyOf("VerifierVerdictEmitted", { verified: false, terminal: false, checks: [{ name: "evidence", passed: false, reason: "no source" }, { name: "x", passed: true }] })).toMatchObject({
      tone: "warn",
      title: "The verifier rejected the answer",
      detail: "evidence: no source",
    });
  });

  it("a passed verdict is listed but never counted; a budget signal that is ok is not an entry", () => {
    expect(safetyBodyOf("VerifierVerdictEmitted", { verified: true, source: "runtime", summary: "ok" })).toMatchObject({ tone: "ok", title: "The result check passed the answer" });
    expect(safetyBodyOf("BudgetSignalCollectedEmitted", { status: "ok" })).toBeUndefined();
    expect(safetyBodyOf("ReasoningStepCompleted", {})).toBeUndefined();
  });

  // Live repro (2026-11-11): every mimo-v2.6 run published CalibrationDrift { deviationSigma: 0, expected = observed }.
  it("a calibration drift whose own numbers show no deviation is not an entry", () => {
    expect(safetyBodyOf("CalibrationDrift", { modelId: "m", expectedMean: 0.31, observedMean: 0.31, deviationSigma: 0 })).toBeUndefined();
    expect(safetyBodyOf("CalibrationDrift", { modelId: "m", expectedMean: 0.3, observedMean: 0.7, deviationSigma: 2.5 })).toMatchObject({
      title: "m is behaving unlike its calibration (2.5σ off)",
    });
  });

  it("places each entry in the loop that was running when it fired", () => {
    const entries = safetyEntriesOf([
      ev("AgentStarted"),
      ev("GuardrailReviewFlagged", { side: "input", dimension: "pii" }),
      ev("LLMRequestStarted"),
      ev("InterventionDispatched", { iteration: 0, decisionType: "compress" }), // kernel numbering can lag: position decides
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("ContextWindowWarning", { utilizationPct: 80 }),
      ev("ReasoningIterationProgress", { iteration: 2 }),
      ev("ReasoningIterationProgress", { iteration: 2 }), // a repeated close changes nothing
      ev("VerifierVerdictEmitted", { verified: false, terminal: true, iteration: 2 }),
      ev("VerifierVerdictEmitted", { verified: true, source: "runtime" }),
      ev("AgentCompleted", { success: false }),
    ]);
    expect(entries.map((e) => [e.source, e.phase, e.loop])).toEqual([
      ["GuardrailReviewFlagged", "before", undefined],
      ["InterventionDispatched", "loop", 1],
      ["ContextWindowWarning", "loop", 2],
      // The kernel verdict on loop 2's answer comes after loop 2 closed: its own iteration places it.
      ["VerifierVerdictEmitted", "loop", 2],
      ["VerifierVerdictEmitted", "end", undefined],
    ]);
    expect(safetyPlaceLabel(entries[0]!)).toBe("Before the first loop");
    expect(safetyPlaceLabel(entries[1]!)).toBe("Loop 1");
    expect(safetyPlaceLabel(entries[4]!)).toBe("After the last loop");
  });

  // Live repro (2026-11-11): an output PII screen blocked a finished one-loop run with no iteration on the event.
  it("an output guardrail after the last loop of an ended run is at the end, worded by the detector's message", () => {
    const entries = safetyEntriesOf([
      ev("LLMRequestStarted"),
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("VerifierVerdictEmitted", { source: "kernel", iteration: 1, verified: true, terminal: true }),
      ev("GuardrailViolationDetected", { violations: ["pii-detected: PII detected: Phone number"], score: 0.75, blocked: true }),
      ev("AgentAborted", { causeClass: "failure" }),
    ]);
    expect(entries.map((e) => [e.title, e.phase, e.loop])).toEqual([
      ["The verifier passed the answer", "loop", 1],
      ["A guardrail blocked the run: PII detected: Phone number", "end", undefined],
    ]);
  });

  it("while the run is live, an entry past the last closed loop is in the running loop", () => {
    const entries = safetyEntriesOf([
      ev("LLMRequestStarted"),
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("InterventionDispatched", { decisionType: "early-stop" }),
    ]);
    expect(entries[0]).toMatchObject({ phase: "loop", loop: 2 });
  });

  // Live repro (2026-11-11): `.withBudget({ tokenLimit: 400 })` ended the run with no budget event; the ending says it.
  it("a run the budget ended gets one budget entry at the end, never a second after a budget event", () => {
    const end = ev("AgentCompleted", { success: false, terminationReason: "budget_exceeded", error: "budget_exceeded: tokens 496 ≥ tokenLimit 400" });
    const only = safetyEntriesOf([ev("LLMRequestStarted"), ev("ReasoningIterationProgress", { iteration: 1 }), end]);
    expect(only.map((e) => [e.title, e.detail, e.phase])).toEqual([["The budget stopped the run", "tokens 496 ≥ tokenLimit 400", "end"]]);
    const both = safetyEntriesOf([ev("LLMRequestStarted"), ev("BudgetSignalCollectedEmitted", { iteration: 1, status: "exceeded", tokensUsed: 496, tokenLimit: 400 }), end]);
    expect(both.map((e) => e.source)).toEqual(["BudgetSignalCollectedEmitted"]);
    expect(safetyBodyOf("AgentCompleted", { success: false, terminationReason: "max_iterations" })).toBeUndefined();
  });

  it("summarises the count, the worst tone and a mark per loop", () => {
    const entries = safetyEntriesOf([
      ev("LLMRequestStarted"),
      ev("InterventionDispatched", { decisionType: "compress" }),
      ev("ContextWindowWarning", { utilizationPct: 90 }),
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("GuardrailViolationDetected", { violations: ["pii"], blocked: true }),
      ev("ReasoningIterationProgress", { iteration: 2 }),
      ev("VerifierVerdictEmitted", { verified: true, source: "runtime" }),
    ]);
    const s = safetySummaryOf(entries);
    expect(s.count).toBe(3);
    expect(s.tone).toBe("bad");
    expect([...s.byLoop.entries()]).toEqual([
      [1, { count: 2, tone: "warn" }],
      [2, { count: 1, tone: "bad" }],
    ]);
    expect(safetySummaryOf([])).toEqual({ count: 0, byLoop: new Map() });
  });
});
