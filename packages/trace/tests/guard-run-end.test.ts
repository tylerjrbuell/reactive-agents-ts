// Run: bun test packages/trace/tests/guard-run-end.test.ts --timeout 20000
//
// Task #43 (2026-11-06): a soft guard only PROPOSES an exit; the exit gate
// decides. Traces before 2026-11-06 carry the guard's event with outcome
// "terminate" emitted BEFORE the gate decided, so a denied proposal (deny-once)
// read as a run end. Readers resolve each guard event through the paired
// `exit_gate` event (same iteration, metadata.proposedBy = guard).
import { describe, it, expect } from "bun:test";
import { analyzeCause, analyzeInterventions, gateDecisionFor, guardEndedRun, runEndingGuardEvents } from "../src/index.js";
import type { Trace, TraceEvent } from "../src/index.js";
import { mk } from "./fixtures/mk-event.js";

let seq = 0;
const base = (iter: number) => ({ runId: "r1", iter, seq: seq++, timestamp: 1000 + seq });
const guard = (g: string, outcome: string, reason: string, metadata: Record<string, unknown>, iter: number) =>
  mk({ ...base(iter), kind: "guard-fired", guard: g, outcome, reason, metadata });
const gate = (proposedBy: string, gateDecision: string, iter: number) =>
  guard("exit_gate", gateDecision === "deny-once" ? "block" : gateDecision === "handoff" ? "terminate" : "pass", "r", { proposedBy, gateDecision, outstanding: ["x"], handoffSynthesis: false }, iter);
const started = () => mk({ ...base(-1), kind: "run-started", task: "t", model: "m", provider: "ollama", config: {} });
const completed = () =>
  mk({ ...base(-1), kind: "run-completed", status: "failure", totalTokens: 1, totalCostUsd: 0, durationMs: 1, terminatedBy: "harness_deliverable" });
const assess = (iter: number, evidenceDelta: number) =>
  mk({ ...base(iter), kind: "assessment", phase: "act", band: "green", evidenceDelta, requirementsSatisfied: 0, requirementsOutstanding: 1, deliverablesProduced: 0, deliverablesMissing: 0, burnRatio: 0 });
const trace = (events: TraceEvent[]): Trace => ({ runId: "r1", events });

const STALL = { totalArtifacts: 2, counter: "consecutiveStalled", observed: 4, threshold: 4 };
const LOOP = { loopArtifactCount: 3, counter: "loop", observed: 2, threshold: 2 };

/** Legacy shape (pre-2026-11-06): stall deny-once (labelled terminate), then a loop exit hands off. */
const legacy = (): TraceEvent[] => [
  started(), assess(1, 1),
  guard("stall_deliverable", "terminate", "harness_deliverable", STALL, 3), gate("stall_deliverable", "deny-once", 3),
  guard("loop_resolution", "terminate", "harness_deliverable", LOOP, 5), gate("loop_resolution", "handoff", 5),
  completed(),
];
/** Current shape: the gate emits the guard's event with an outcome from its decision. */
const current = (): TraceEvent[] => [
  started(), assess(1, 1),
  guard("stall_deliverable", "block", "harness_deliverable", STALL, 3), gate("stall_deliverable", "deny-once", 3),
  guard("loop_resolution", "terminate", "harness_deliverable", LOOP, 5), gate("loop_resolution", "handoff", 5),
  completed(),
];

describe("guard-run-end: a guard event ended the run only if the gate let it", () => {
  for (const [name, events] of [["legacy pre-gate terminate", legacy], ["current gate-emitted", current]] as const) {
    it(`${name}: deny-once is not a run end, the later handoff is`, () => {
      const ev = events();
      const ends = runEndingGuardEvents(ev, ["stall_deliverable", "loop_resolution"]);
      expect(ends.map((e) => (e.kind === "guard-fired" ? `${e.guard}@${e.iter}` : ""))).toEqual(["loop_resolution@5"]);
      const stallIdx = ev.findIndex((e) => e.kind === "guard-fired" && e.guard === "stall_deliverable");
      expect(gateDecisionFor(ev, stallIdx)).toBe("deny-once");
      expect(guardEndedRun(ev, stallIdx)).toBe(false);
    });

    it(`${name}: analyzeCause names the guard that ended the run (loop), not the denied stall`, () => {
      expect(analyzeCause(trace(events())).cause).toBe("loop-after-work");
    });

    it(`${name}: a denied proposal is never the run's terminal decision`, () => {
      // The model finished on its own after the nudge: no guard ended the run.
      const ev = events().filter((e) => !(e.kind === "guard-fired" && e.iter === 5));
      expect(analyzeInterventions(trace(ev)).terminalDecision).toBeUndefined();
      expect(analyzeInterventions(trace(events())).terminalDecision?.guard).toBe("exit_gate");
    });
  }

  it("a guard event with no paired gate event keeps its own outcome (traces older than the gate)", () => {
    const ev = [guard("stall_deliverable", "terminate", "harness_deliverable", STALL, 2)];
    expect(gateDecisionFor(ev, 0)).toBeUndefined();
    expect(guardEndedRun(ev, 0)).toBe(true);
    expect(guardEndedRun([guard("stall_deliverable", "block", "x", STALL, 2)], 0)).toBe(false);
  });

  it("pairs by iteration and proposer: another guard's gate record, or a later iteration's, does not count", () => {
    const ev = [
      guard("stall_deliverable", "terminate", "h", STALL, 2), gate("loop_resolution", "deny-once", 2), gate("stall_deliverable", "deny-once", 3),
    ];
    expect(gateDecisionFor(ev, 0)).toBeUndefined();
  });
});
