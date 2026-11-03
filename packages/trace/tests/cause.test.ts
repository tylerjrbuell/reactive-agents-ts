import { describe, it, expect } from "bun:test";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeCause, analyzeRun, loadTrace, tallyCauses } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import labels from "./fixtures/cause-labels-2026-11-03.json";

// ── Minimal synthetic event builders ──────────────────────────────────────────
let seq = 0;
const base = (iter = 0) => ({ runId: "r1", iter, seq: seq++, timestamp: 1000 + seq });
const mk = (e: Record<string, unknown>): TraceEvent => e as unknown as TraceEvent;

const started = (extra: Record<string, unknown> = {}) =>
  mk({ ...base(-1), kind: "run-started", task: "t", model: "m", provider: "ollama", config: {}, ...extra });
const completedEv = (
  status: "success" | "failure",
  extra: Record<string, unknown> = {},
) =>
  mk({
    ...base(-1), kind: "run-completed", status, totalTokens: 1, totalCostUsd: 0, durationMs: 1, ...extra,
  });
const guard = (g: string, outcome: string, reason: string, metadata?: Record<string, unknown>, iter = 1) =>
  mk({ ...base(iter), kind: "guard-fired", guard: g, outcome, reason, ...(metadata ? { metadata } : {}) });
const terminal = (status: string, terminatedBy: string, authority = "model-final", extra: Record<string, unknown> = {}) =>
  guard("terminal_decision", "terminate", terminatedBy, { terminatedBy, status, authority, ...extra });
const surface = (visible: string[]) =>
  mk({ ...base(0), kind: "tool-surface-resolved", visible, callable: visible, reasons: [] });
const toolEnd = (toolName: string, ok: boolean, args: unknown = {}) =>
  mk({ ...base(), kind: "tool-call-end", toolName, ok, args, error: ok ? undefined : "boom" });
const toolStart = (toolName: string) => mk({ ...base(), kind: "tool-call-start", toolName });
const contract = (reqs: { id: string; kind: string }[], deliverables: { id: string; kind: string }[] = []) =>
  mk({ ...base(0), kind: "contract-compiled", requirements: reqs, deliverables, horizon: "short" });
const assess = (iter: number, evidenceDelta: number) =>
  mk({ ...base(iter), kind: "assessment", phase: "act", band: "green", evidenceDelta, requirementsSatisfied: 0, requirementsOutstanding: 1, deliverablesProduced: 0, deliverablesMissing: 0, burnRatio: 0 });
const verdict = (verified: boolean, terminalFlag = true, source?: "runtime") =>
  mk({ ...base(), kind: "verifier-verdict", action: "final-answer", terminal: terminalFlag, verified, summary: "s", checks: [{ name: "c1", passed: verified }], ...(source ? { source } : {}) });
const trace = (events: TraceEvent[]): Trace => ({ runId: "r1", events });

describe("analyzeCause — per-rule synthetic fixtures", () => {
  it("rule 1: run-aborted with no run-completed is a decisive incomplete-trace", () => {
    const t = trace([started(), mk({ ...base(-1), kind: "run-aborted", causeClass: "interrupt", error: "fiber interrupted", durationMs: 5 })]);
    const c = analyzeCause(t);
    expect(c).toMatchObject({ cause: "incomplete-trace", subCause: "interrupt", confidence: "decisive", outcomeStatus: "aborted" });
  });

  it("rule 1: no sentinel at all is only probable and names the missing signal", () => {
    const c = analyzeCause(trace([started()]));
    expect(c.cause).toBe("incomplete-trace");
    expect(c.confidence).toBe("probable");
    expect(c.missing[0]).toContain("run-aborted");
  });

  it("rule 2: llm_error terminal is provider-error with a sub-class from the error text", () => {
    const t = trace([
      started(), terminal("failed", "llm_error", "error"),
      completedEv("failure", { terminatedBy: "llm_error", error: "Your credit balance is too low" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "provider-error", subCause: "quota", confidence: "decisive" });
  });

  it("rule 3: satisfiability-preflight guard is satisfiability-abstain; non-user origin tags utility-misroute", () => {
    const t = trace([
      started({ origin: "cortex-utility" }),
      guard("satisfiability-preflight", "terminate", "missing capability", { missing: ["capability:x"] }, 0),
      completedEv("failure", { terminatedBy: "abstained" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "satisfiability-abstain", subCause: "utility-misroute", confidence: "decisive" });
  });

  it("rule 4: success with deliverable_decision=block is terminal-mislabel", () => {
    const t = trace([
      started(), guard("deliverable_decision", "block", "unverified", { accepted: false }),
      terminal("done", "end_turn"), completedEv("success", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "terminal-mislabel", confidence: "decisive" });
  });

  it("rule 4: a DISCLOSED override (terminal_status_override) is not a mislabel", () => {
    const t = trace([
      started(), verdict(true), terminal("done", "end_turn"),
      guard("terminal_status_override", "warn", "gate-verdict", { labelsDisagree: true }),
      completedEv("failure", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t).cause).not.toBe("terminal-mislabel");
  });

  it("rule 4: verified kernel verdict + done + failure with NO override is terminal-mislabel", () => {
    const t = trace([started(), verdict(true), terminal("done", "end_turn"), completedEv("failure", { terminatedBy: "end_turn" })]);
    expect(analyzeCause(t).cause).toBe("terminal-mislabel");
  });

  it("rule 5: plan posture + contract-coverage veto is plan-posture-veto", () => {
    const t = trace([
      started(), guard("posture-applied", "pass", "plan posture", { posture: "plan" }, 0),
      terminal("done", "end_turn"),
      guard("terminal_status_override", "warn", "contract-coverage", { labelsDisagree: true }),
      completedEv("failure", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "plan-posture-veto", confidence: "decisive" });
  });

  it("rule 6: real tools visible, zero real calls, failure => never-engaged", () => {
    const t = trace([
      started(), surface(["file-write", "recall"]), toolEnd("recall", true),
      terminal("done", "end_turn"), completedEv("failure", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "never-engaged", confidence: "decisive" });
  });

  it("rule 6: a successful tool-free answer with only an 'answer' contract is NOT never-engaged", () => {
    const t = trace([
      started(), surface(["web-search"]), contract([{ id: "answer", kind: "question-answered" }]),
      guard("deliverable_decision", "pass", "verified", { accepted: true }),
      terminal("done", "end_turn"), completedEv("success", { terminatedBy: "end_turn", outcome: { status: "completed", terminatedBy: "end_turn", provenance: "model-final", verdict: null, answerSatisfied: true, success: true, authority: "model-final" } }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "none", confidence: "decisive" });
  });

  it("rule 6: a success whose contract demands a tool but made zero calls IS never-engaged", () => {
    const t = trace([
      started(), surface(["file-write"]), contract([{ id: "tool:file-write", kind: "tool-coverage" }]),
      terminal("done", "end_turn"), completedEv("success", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t).cause).toBe("never-engaged");
  });

  it("rule 7: strategy-switched on consecutive-thoughts is tool-protocol", () => {
    const t = trace([
      started(), mk({ ...base(-1), kind: "strategy-switched", from: "reactive", to: "plan-execute-reflect", reason: "consecutive-thoughts: 3" }),
      terminal("failed", "end_turn"), completedEv("failure", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t).cause).toBe("tool-protocol");
  });

  it("rule 8: repeated identical ok:false calls => tool-failure", () => {
    const t = trace([
      started(), toolEnd("code-execute", false, { l: "py" }), toolEnd("code-execute", false, { l: "py" }),
      terminal("done", "x"), completedEv("failure", { terminatedBy: "x" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "tool-failure", subCause: "repeated-identical-call" });
  });

  it("rule 8b: first failure then a different successful call => wrong-tool-arg", () => {
    const t = trace([
      started(), toolEnd("code-execute", false, { l: "py" }), toolEnd("file-write", true, { p: "a" }),
      terminal("done", "x"), completedEv("failure", { terminatedBy: "x" }),
    ]);
    expect(analyzeCause(t).cause).toBe("wrong-tool-arg");
  });

  it("rule 9: stall_deliverable with artifacts => stall-after-work; with none and no evidence => stall-no-progress", () => {
    const withWork = trace([
      started(), toolEnd("file-write", true), assess(1, 2),
      guard("stall_deliverable", "terminate", "harness_deliverable", { totalArtifacts: 2, counter: "consecutiveStalled", observed: 4, threshold: 4 }),
      terminal("done", "harness_deliverable"), completedEv("success", { terminatedBy: "harness_deliverable" }),
    ]);
    expect(analyzeCause(withWork)).toMatchObject({ cause: "stall-after-work", confidence: "decisive" });
    const noWork = trace([
      started(), assess(1, 0),
      guard("stall_deliverable", "terminate", "harness_deliverable", { totalArtifacts: 0, counter: "consecutiveStalled", observed: 4, threshold: 4 }),
      terminal("done", "harness_deliverable"), completedEv("failure", { terminatedBy: "harness_deliverable" }),
    ]);
    expect(analyzeCause(noWork).cause).toBe("stall-no-progress");
  });

  it("rule 10: mostly meta-tool calls ending at max_iterations => bookkeeping-loop", () => {
    const t = trace([
      started(), toolStart("recall"), toolStart("brief"), toolStart("pulse"), toolStart("file-read"),
      terminal("failed", "max_iterations"), completedEv("failure", { terminatedBy: "max_iterations" }),
    ]);
    expect(analyzeCause(t).cause).toBe("bookkeeping-loop");
  });

  it("rule 11: deliverable_decision=block on a failure => verifier-reject, tagged by tool evidence", () => {
    const t = trace([
      started(), guard("deliverable_decision", "block", "output-is-model-authored", { accepted: false }),
      terminal("done", "end_turn"), completedEv("failure", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "verifier-reject", subCause: "no-tool-evidence" });
  });

  it("rule 12: iterationCap.capped with evidence still growing => budget-cap/cap-cutoff", () => {
    const t = trace([
      started(), assess(1, 0), assess(2, 3),
      terminal("failed", "max_iterations", "guard", { iterationCap: { counter: "iteration", observed: 8, threshold: 8, llmCalls: 8, capped: true } }),
      completedEv("failure", { terminatedBy: "max_iterations" }),
    ]);
    expect(analyzeCause(t)).toMatchObject({ cause: "budget-cap", subCause: "cap-cutoff", confidence: "decisive" });
  });

  it("residual: failure with terminal signals and no matching rule => unexplained (never model-incapable)", () => {
    const t = trace([started(), terminal("done", "weird"), completedEv("failure", { terminatedBy: "weird" })]);
    const c = analyzeCause(t);
    expect(c.cause).toBe("unexplained");
    expect(c.missing[0]).toContain("cohort");
  });

  it("legacy: failure with no terminal_decision and no matching rule => insufficient-trace, never a guess", () => {
    const t = trace([started(), completedEv("failure")]);
    const c = analyzeCause(t);
    expect(c).toMatchObject({ cause: "undetermined", confidence: "insufficient-trace" });
    expect(c.missing).toContain("terminal_decision.authority");
  });

  it("success: verifier-rejected success is none/probable and asks for the verifier evidence set", () => {
    const t = trace([started(), verdict(false), terminal("done", "end_turn"), completedEv("success", { terminatedBy: "end_turn", outcome: { status: "completed", terminatedBy: "end_turn", provenance: "model-final", verdict: null, answerSatisfied: true, success: true } })]);
    const c = analyzeCause(t);
    expect(c.cause).toBe("none");
    expect(c.confidence).toBe("probable");
    expect(c.missing.join()).toContain("verifier evidence set");
  });
});

describe("analyzeCause — red-on-cut (removing the signal flips the verdict)", () => {
  const withSentinel = (): TraceEvent[] => [started(), mk({ ...base(-1), kind: "run-aborted", causeClass: "defect", durationMs: 1 })];
  it("cut run-aborted: decisive incomplete-trace degrades to probable", () => {
    expect(analyzeCause(trace(withSentinel())).confidence).toBe("decisive");
    expect(analyzeCause(trace(withSentinel().slice(0, 1))).confidence).toBe("probable");
  });

  const plan = (withOverride: boolean): TraceEvent[] => [
    started(), guard("posture-applied", "pass", "plan", { posture: "plan" }, 0), terminal("done", "end_turn"),
    ...(withOverride ? [guard("terminal_status_override", "warn", "contract-coverage", { labelsDisagree: true })] : []),
    completedEv("failure", { terminatedBy: "end_turn" }),
  ];
  it("cut terminal_status_override: plan-posture-veto disappears", () => {
    expect(analyzeCause(trace(plan(true))).cause).toBe("plan-posture-veto");
    expect(analyzeCause(trace(plan(false))).cause).not.toBe("plan-posture-veto");
  });

  const engaged = (withVisible: boolean): TraceEvent[] => [
    started(), ...(withVisible ? [surface(["file-write"])] : []),
    terminal("done", "end_turn"), completedEv("failure", { terminatedBy: "end_turn" }),
  ];
  it("cut tool-surface-resolved: never-engaged becomes untestable (no guessing)", () => {
    expect(analyzeCause(trace(engaged(true))).cause).toBe("never-engaged");
    expect(analyzeCause(trace(engaged(false))).cause).not.toBe("never-engaged");
  });

  const stall = (artifacts: number, delta: number): TraceEvent[] => [
    started(), assess(1, delta),
    guard("stall_deliverable", "terminate", "harness_deliverable", { totalArtifacts: artifacts, counter: "consecutiveStalled", observed: 4, threshold: 4 }),
    terminal("done", "harness_deliverable"), completedEv("failure", { terminatedBy: "harness_deliverable" }),
  ];
  it("cut the work evidence: stall-after-work becomes stall-no-progress", () => {
    expect(analyzeCause(trace(stall(2, 1))).cause).toBe("stall-after-work");
    expect(analyzeCause(trace(stall(0, 0))).cause).toBe("stall-no-progress");
  });

  const cap = (withCapMeta: boolean): TraceEvent[] => [
    started(), assess(2, 1),
    terminal("failed", "max_iterations", "guard", withCapMeta ? { iterationCap: { counter: "iteration", observed: 8, threshold: 8, llmCalls: 8, capped: true } } : {}),
    completedEv("failure", { terminatedBy: "max_iterations" }),
  ];
  it("cut iterationCap evidence: budget-cap decisive degrades to probable with the missing signal named", () => {
    expect(analyzeCause(trace(cap(true))).confidence).toBe("decisive");
    const c = analyzeCause(trace(cap(false)));
    expect(c.confidence).toBe("probable");
    expect(c.missing.join()).toContain("iterationCap");
  });
});

describe("analyzeRun wiring", () => {
  it("aborted run is labelled aborted (not honest-failure) and carries a cause", () => {
    const a = analyzeRun(trace([started(), mk({ ...base(-1), kind: "run-aborted", causeClass: "interrupt", durationMs: 1 })]));
    expect(a.honesty.label).toBe("aborted");
    expect(a.status).toBeUndefined();
    expect(a.cause.cause).toBe("incomplete-trace");
  });

  it("overlap-storm does not fire on a success unless a storm iteration holds a terminating guard", () => {
    const noise = trace([
      started(), guard("a", "pass", "x", undefined, 1), guard("b", "pass", "y", undefined, 1),
      terminal("done", "end_turn"), completedEv("success", { terminatedBy: "end_turn" }),
    ]);
    expect(analyzeRun(noise).failureModes.map((f) => f.mode)).not.toContain("overlap-storm");
    const correlated = trace([
      started(), guard("a", "pass", "x", undefined, 1), guard("stall_deliverable", "terminate", "x", undefined, 1),
      completedEv("success", { terminatedBy: "harness_deliverable" }),
    ]);
    expect(analyzeRun(correlated).failureModes.map((f) => f.mode)).toContain("overlap-storm");
    const failed = trace([started(), guard("a", "pass", "x", undefined, 1), guard("b", "pass", "y", undefined, 1), completedEv("failure")]);
    expect(analyzeRun(failed).failureModes.map((f) => f.mode)).toContain("overlap-storm");
  });
});

describe("tallyCauses", () => {
  it("counts by cause, confidence and cause x status", () => {
    const a = analyzeCause(trace([started(), terminal("failed", "llm_error", "error"), completedEv("failure", { terminatedBy: "llm_error", error: "x" })]));
    const b = analyzeCause(trace([started()]));
    const t = tallyCauses([a, a, b]);
    expect(t.total).toBe(3);
    expect(t.byCause["provider-error"]).toBe(2);
    expect(t.byConfidence.decisive).toBe(2);
    expect(t.byCauseAndStatus["incomplete-trace|unknown"]).toBe(1);
  });
});

// ── Acceptance: hand-labelled real cells (2026-11-03 signal confirmation) ──────
const CELLS = join(import.meta.dir, "../../../wiki/Research/Harness-Reports/2026-11-03-signal-confirmation-traces");
describe.skipIf(!existsSync(CELLS))("acceptance — 24 hand-labelled real cells", () => {
  const entries = Object.entries(labels.labels);
  it("has all 24 labels", () => expect(entries.length).toBe(24));
  for (const [cell, expected] of entries) {
    it(`${cell} => ${expected}`, async () => {
      const dir = join(CELLS, cell, "trace");
      const file = readdirSync(dir).find((f) => f.endsWith(".jsonl") && f !== "llm-direct.jsonl");
      expect(file).toBeDefined();
      const c = analyzeCause(await loadTrace(join(dir, file!)));
      // Every verdict the classifier marks decisive must match the human label.
      if (c.confidence === "decisive") expect(c.cause).toBe(expected as string);
      // Coverage pin: no cell may degrade to insufficient-trace on these fresh-signal traces.
      expect(c.confidence).not.toBe("insufficient-trace");
    });
  }
  it("matches the label on every cell it does not mark decisive too (current coverage)", async () => {
    let decisive = 0;
    for (const [cell, expected] of entries) {
      const dir = join(CELLS, cell, "trace");
      const file = readdirSync(dir).find((f) => f.endsWith(".jsonl") && f !== "llm-direct.jsonl")!;
      const c = analyzeCause(await loadTrace(join(dir, file)));
      expect(c.cause).toBe(expected as string);
      if (c.confidence === "decisive") decisive++;
    }
    expect(decisive).toBeGreaterThanOrEqual(23);
  });
});
