// Run: bun test packages/trace/tests/cause-abort-budget-loops.test.ts --timeout 15000
//
// Cortex live QA 2026-11-11 (487399ff0), four instrument faults:
//   1. A guardrail-blocked run (run-aborted, no reason) was labelled
//      `incomplete-trace` ("wrote neither run-completed nor run-aborted") while
//      citing the run-aborted event as its evidence.
//   2. A token-budget stop (`budget_exceeded`) was told to "raise the iteration budget".
//   3. `traceStats.iterations` overcounted kernel loops by one (max iter + 1 over
//      the post-increment snapshot) and read 0 for plan-execute-reflect, whose
//      loops only exist as `ReasoningIterationProgress` events the trace dropped.
//   4. `StructuredOutputReported` and `ToolCallStarted.args` never reached the trace.
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import {
  analyzeCause,
  attributeFailure,
  causeDescription,
  causeNextActions,
  parseTrace,
  toTraceEvent,
  traceStats,
} from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

let seq = 0;
const base = (iter = 0) => ({ runId: "r1", iter, seq: seq++, timestamp: 1000 + seq });
const trace = (events: TraceEvent[]): Trace => ({ runId: "r1", events });
const started = () => mk({ ...base(-1), kind: "run-started", task: "t", model: "m", provider: "ollama", config: {} });
const guard = (g: string, outcome: string, reason: string, metadata?: Record<string, unknown>, iter = 1) =>
  mk({ ...base(iter), kind: "guard-fired", guard: g, outcome, reason, ...(metadata ? { metadata } : {}) });
const snapshot = (iter: number, status: string, terminatedBy?: string) =>
  mk({
    ...base(iter), kind: "kernel-state-snapshot", status, toolsUsed: [], scratchpadKeys: [], stepsCount: 0, stepsByType: {},
    outputPreview: "", outputLen: 0, messagesCount: 0, tokens: 0, cost: 0, llmCalls: 0, ...(terminatedBy ? { terminatedBy } : {}),
  });
const entropy = (iter: number) =>
  mk({ ...base(iter), kind: "entropy-scored", composite: 0.2, sources: {}, sourcesPresent: 2, confidence: "low", trajectoryShape: "flat", modelTier: "local" });
const abortedEv = (causeClass: string, error?: string, reason?: string) =>
  mk({ ...base(-1), kind: "run-aborted", causeClass, durationMs: 9, ...(error ? { error } : {}), ...(reason ? { reason } : {}) });
const completed = (status: "success" | "failure", extra: Record<string, unknown> = {}) =>
  mk({ ...base(-1), kind: "run-completed", status, totalTokens: 1, totalCostUsd: 0, durationMs: 1, ...extra });

// ── 1. guardrail abort ─────────────────────────────────────────────────────────

/** Shape of the 2026-11-10 Cortex run: the kernel finished, then the output guardrail blocked the answer. */
const guardrailBlocked = (): TraceEvent[] => [
  started(),
  snapshot(0, "thinking"),
  snapshot(1, "done", "end_turn"),
  guard("deliverable_decision", "pass", "verified"),
  guard("terminal_decision", "terminate", "end_turn", { terminatedBy: "end_turn", status: "done", authority: "model-final" }),
  abortedEv("failure", "GuardrailViolationError: Output guardrail check failed: pii-detected: PII detected: Phone number"),
];

describe("run-aborted without a reason", () => {
  it("a guardrail block is aborted/guardrail-block, decisive, from the error tag", () => {
    const c = analyzeCause(trace(guardrailBlocked()));
    expect(c).toMatchObject({ cause: "aborted", subCause: "guardrail-block", confidence: "decisive", outcomeStatus: "aborted" });
    expect(c.evidence[0]!.eventKind).toBe("run-aborted");
    expect(c.missing).toEqual([]);
  });

  it("its words name the guardrail and never claim the run wrote no run-aborted", () => {
    const c = analyzeCause(trace(guardrailBlocked()));
    expect(causeDescription(c.cause, c.subCause)).toMatch(/guardrail/i);
    const actions = causeNextActions(c).join(" ");
    expect(actions).toMatch(/guardrail/i);
    expect(actions).not.toMatch(/neither run-completed nor run-aborted/);
  });

  it("is owned by the environment (a policy block), not left unattributed", () => {
    expect(attributeFailure(trace(guardrailBlocked()))).toMatchObject({ reason: "environment:run-aborted", cause: "aborted/guardrail-block" });
  });

  it("an unidentified abort is aborted/<causeClass>, probable, naming run-aborted.reason as missing", () => {
    const c = analyzeCause(trace([started(), abortedEv("failure", "SomeOtherError: boom")]));
    expect(c).toMatchObject({ cause: "aborted", subCause: "failure", confidence: "probable" });
    expect(c.missing.join()).toContain("run-aborted.reason");
  });

  it("an unidentified crash (defect) is not blamed on the environment", () => {
    const a = attributeFailure(trace([started(), abortedEv("defect", "TypeError: x is undefined")]));
    expect(a.reason).toBe("unattributed");
  });

  it("red-on-cut: drop the run-aborted event and it is incomplete-trace again", () => {
    expect(analyzeCause(trace(guardrailBlocked().slice(0, -1))).cause).toBe("incomplete-trace");
  });
});

// ── 2. token / cost budget ─────────────────────────────────────────────────────

const spendStop = (error: string): TraceEvent[] => [
  started(),
  guard("terminal_decision", "terminate", "budget_exceeded", {
    terminatedBy: "budget_exceeded", status: "failed", authority: "budget",
    iterationCap: { counter: "iteration", observed: 1, threshold: 5, llmCalls: 1, capped: false },
  }),
  completed("failure", { terminatedBy: "budget_exceeded", error }),
];

describe("budget-cap: token and cost budgets are not the iteration budget", () => {
  it("a token-limit stop is budget-cap/token-budget and says token budget", () => {
    const c = analyzeCause(trace(spendStop("budget_exceeded: tokens 496 ≥ tokenLimit 400")));
    expect(c).toMatchObject({ cause: "budget-cap", subCause: "token-budget", confidence: "decisive" });
    expect(causeDescription(c.cause, c.subCause)).toMatch(/token budget/);
    const actions = causeNextActions(c).join(" ");
    expect(actions).toMatch(/token/);
    expect(actions).not.toMatch(/iteration/);
  });

  it("a cost-limit stop is budget-cap/cost-budget", () => {
    const c = analyzeCause(trace(spendStop("budget_exceeded: cost $0.0123 ≥ costLimit $0.0100")));
    expect(c).toMatchObject({ cause: "budget-cap", subCause: "cost-budget" });
    expect(causeDescription(c.cause, c.subCause)).toMatch(/cost budget/);
    expect(causeNextActions(c).join(" ")).not.toMatch(/iteration/);
  });

  it("a spend stop whose limit is not named is budget-cap/spend-budget, never an iteration claim", () => {
    const c = analyzeCause(trace(spendStop("budget_exceeded: budget limit reached")));
    expect(c.subCause).toBe("spend-budget");
    expect(causeNextActions(c).join(" ")).not.toMatch(/iteration/);
  });

  it("red-on-cut: an iteration cap still reads as the iteration budget", () => {
    const c = analyzeCause(trace([
      started(),
      guard("terminal_decision", "terminate", "max_iterations", {
        terminatedBy: "max_iterations", status: "failed", authority: "strategy-exhausted",
        iterationCap: { counter: "iteration", observed: 3, threshold: 3, llmCalls: 3, capped: true },
      }),
      completed("failure", { terminatedBy: "max_iterations" }),
    ]));
    expect(c.cause).toBe("budget-cap");
    expect(["cap-cutoff", "no-progress-at-cap", "unknown-progress"]).toContain(c.subCause);
    expect(causeDescription(c.cause, c.subCause)).toMatch(/iteration budget/);
  });

  it("the cause-only description no longer claims the iteration budget for every budget stop", () => {
    expect(causeDescription("budget-cap")).not.toMatch(/iteration budget/);
  });
});

// ── 3. loop count ──────────────────────────────────────────────────────────────

const progress = (iteration: number, strategy = "reactive"): AgentEvent => ({
  _tag: "ReasoningIterationProgress", taskId: "r1", iteration, maxIterations: 10, strategy, toolsThisStep: [],
});
const fromBus = (events: readonly AgentEvent[]): TraceEvent[] =>
  events.map((e) => toTraceEvent(e, seq++)).filter((e): e is TraceEvent => e !== null);

describe("traceStats.iterations matches the event stream's loop count", () => {
  it("a one-loop reactive run is 1 loop, not 2 (snapshots carry the post-increment iteration)", () => {
    expect(traceStats(trace([started(), snapshot(0, "thinking"), entropy(0), snapshot(1, "done", "end_turn"), completed("success")])).iterations).toBe(1);
  });

  it("ReasoningIterationProgress reaches the trace as iteration-exit, and it is the count when present", () => {
    const ev = fromBus([progress(1, "plan-execute-reflect"), progress(2, "plan-execute-reflect"), progress(3, "plan-execute-reflect")]);
    expect(ev.map((e) => e.kind)).toEqual(["iteration-exit", "iteration-exit", "iteration-exit"]);
    expect(ev[2]).toMatchObject({ iter: 3, strategy: "plan-execute-reflect", maxIterations: 10, toolsThisStep: [] });
    // plan-execute-reflect: no kernel snapshots, only an entropy score and the step progress.
    expect(traceStats(trace([started(), entropy(1), ...ev, completed("success")])).iterations).toBe(3);
  });

  it("a repeated report of the same iteration is one loop (the rule Cortex's replay uses)", () => {
    expect(traceStats(trace([started(), ...fromBus([progress(1), progress(1), progress(2)]), completed("success")])).iterations).toBe(2);
  });

  it("legacy entropy-only traces keep max iter + 1 (entropy iter is the 0-based loop index)", () => {
    expect(traceStats(trace([started(), entropy(0), entropy(1), completed("success")])).iterations).toBe(2);
  });

  it("the new kinds survive a JSONL round trip (isTraceEvent knows them)", () => {
    const ev = fromBus([progress(1)]);
    expect(parseTrace(ev.map((e) => JSON.stringify(e)).join("\n")).events).toHaveLength(1);
  });
});

// ── 4. new event records ───────────────────────────────────────────────────────

describe("normalize: StructuredOutputReported and ToolCallStarted.args", () => {
  it("ToolCallStarted carries its args onto tool-call-start", () => {
    const [ev] = fromBus([{ _tag: "ToolCallStarted", taskId: "r1", toolName: "file-read", callId: "c1", iteration: 2, args: { path: "a.txt" } }]);
    expect(ev).toMatchObject({ kind: "tool-call-start", toolName: "file-read", iter: 2, args: { path: "a.txt" } });
  });

  it("ToolCallStarted without args stays without args (byte-identical to before)", () => {
    const [ev] = fromBus([{ _tag: "ToolCallStarted", taskId: "r1", toolName: "file-read", callId: "c1" }]);
    expect(ev !== undefined && "args" in ev).toBe(false);
  });

  it("StructuredOutputReported becomes a structured-output-reported record that round-trips", () => {
    const report = {
      outcome: "success", layer: "repaired", native: "not-attempted", attempts: 1, promptAttempts: 1,
      repairs: ["trailing-commas"], coerced: false, budgetEscalated: false, fieldErrors: [],
    } as const;
    const ev = fromBus([{ _tag: "StructuredOutputReported", taskId: "r1", strategy: "plan-execute", report, timestamp: 42 }]);
    expect(ev[0]).toMatchObject({ kind: "structured-output-reported", runId: "r1", iter: -1, timestamp: 42, strategy: "plan-execute", report });
    expect(parseTrace(JSON.stringify(ev[0])).events).toHaveLength(1);
  });
});
