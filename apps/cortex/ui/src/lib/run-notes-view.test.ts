import { describe, expect, it } from "bun:test";
import { runNotesOf, runNotesFromStorage } from "@reactive-agents/ui-core";
import { checklistGuardTitle, runNotesFromRunEvents, runNotesView } from "./run-notes-view.js";
import { traceTitle } from "./stores/timeline-store.js";

const CHECKLIST = {
  total: 4,
  done: 2,
  closedByHarness: [
    { id: "1", title: "Search the web", provenance: "harness:evidence", toolCallId: "c1" },
    { id: "3", title: "Write the summary", provenance: "harness:answer" },
  ],
  unresolved: [{ id: "2", title: "Open the pricing page", status: "pending", reason: "no evidence" }],
};

const completion = {
  metadata: { extensions: { checklist: CHECKLIST, terminalOutcome: { authority: "strategy-accepted" } } },
  receipt: { interventions: [{ actor: "unread-results-synthesis", evidence: "unread: web-search, http-get", whatChanged: "unread-results-synthesis: answer synthesized over x" }] },
};

describe("runNotesView", () => {
  it("shapes the to-do outcome, the unread note and the accepted finish for the views", () => {
    const view = runNotesView(runNotesOf(completion))!;
    expect(view.accepted).toEqual({ heading: "Accepted by the strategy", text: expect.stringContaining("accepted") });
    expect(view.unread).toEqual({ text: "The answer was written from tool results the model had not read.", tools: ["web-search", "http-get"] });
    expect(view.checklist?.summary).toBe("To-do 2/4");
    expect(view.checklist?.closed).toEqual([
      { id: "1", title: "Search the web", note: "closed by the harness from a tool result" },
      { id: "3", title: "Write the summary", note: "closed by the harness: the answer delivered it" },
    ]);
    expect(view.checklist?.unresolvedLine).toBe("1 of 4 to-do rows ended with no evidence");
    expect(view.checklist?.unresolved).toEqual([{ id: "2", title: "Open the pricing page", note: "no evidence recorded" }]);
  });

  it("is the same after the turn is stored and reloaded", () => {
    const notes = runNotesOf(completion);
    expect(runNotesView(runNotesFromStorage(JSON.parse(JSON.stringify(notes))))).toEqual(runNotesView(notes));
  });

  it("says nothing for a run with every row done by the model, a plain authority and no unread note", () => {
    expect(runNotesView(runNotesOf({ metadata: { extensions: { checklist: { total: 2, done: 2, closedByHarness: [], unresolved: [] }, terminalOutcome: { authority: "model-final" } } } }))).toBeUndefined();
    expect(runNotesView(undefined)).toBeUndefined();
  });

  it("an unknown authority and provenance degrade to quiet generic wording", () => {
    const view = runNotesView(
      runNotesOf({ metadata: { extensions: { terminalOutcome: { authority: "from-the-future" }, checklist: { total: 1, done: 1, closedByHarness: [{ id: "1", title: "A", provenance: "harness:new" }], unresolved: [] } } } }),
    )!;
    expect(view.accepted).toBeUndefined();
    expect(view.checklist?.closed[0]?.note).toBe("closed by the harness");
  });
});

describe("checklist-unresolved guard in the trace feed", () => {
  const trace = { kind: "guard-fired" as const, guard: "checklist-unresolved", outcome: "warn", reason: "1 of 4 todo rows ended with no evidence: 2 \"Open the pricing page\"", metadata: { unresolved: CHECKLIST.unresolved, done: 2, total: 4 } };

  it("is one quiet line, in the same words as the run note", () => {
    expect(checklistGuardTitle(trace)).toBe("1 of 4 to-do rows ended with no evidence");
    expect(traceTitle(trace as never)).toBe("1 of 4 to-do rows ended with no evidence");
  });

  it("falls back to the guard's own reason when its metadata is unreadable, and leaves other guards alone", () => {
    expect(checklistGuardTitle({ guard: "checklist-unresolved", reason: "rows open" })).toBe("rows open");
    expect(checklistGuardTitle({ guard: "plan_budget_raised", reason: "raised" })).toBeUndefined();
    expect(traceTitle({ kind: "guard-fired", guard: "wire-request", outcome: "pass", reason: "ok" } as never)).toBe("guard wire-request pass: ok");
  });
});

describe("runNotesFromRunEvents (a desk run)", () => {
  const guard = {
    type: "GuardFiredEmitted",
    payload: { guard: "checklist-unresolved", outcome: "warn", reason: "1 of 4 todo rows ended with no evidence", metadata: { unresolved: CHECKLIST.unresolved, done: 2, total: 4 } },
  };

  it("reads the unresolved rows from the guard event and the authority from AgentCompleted.outcome", () => {
    const notes = runNotesFromRunEvents([
      { type: "ReasoningIterationProgress", payload: {} },
      guard,
      { type: "AgentCompleted", payload: { success: true, outcome: { status: "completed", authority: "strategy-accepted" } } },
    ])!;
    expect(notes.authority).toBe("strategy-accepted");
    expect(notes.checklist?.unresolved.map((u) => u.title)).toEqual(["Open the pricing page"]);
    expect(runNotesView(notes)?.checklist?.unresolvedLine).toBe("1 of 4 to-do rows ended with no evidence");
  });

  it("prefers the completion's own reconciliation (it carries the harness closures)", () => {
    const notes = runNotesFromRunEvents([guard, { type: "AgentCompleted", payload: { success: true, metadata: { extensions: { checklist: CHECKLIST } } } }])!;
    expect(notes.checklist?.closed).toHaveLength(2);
  });

  it("reads nothing from a run with neither, and ignores other guards", () => {
    expect(runNotesFromRunEvents([{ type: "AgentCompleted", payload: { success: true } }])).toBeUndefined();
    expect(runNotesFromRunEvents([{ type: "GuardFiredEmitted", payload: { guard: "plan_budget_raised", metadata: { effective: 9 } } }])).toBeUndefined();
    expect(runNotesFromRunEvents([])).toBeUndefined();
  });
});
