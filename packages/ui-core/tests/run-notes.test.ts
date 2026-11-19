import { describe, expect, it } from "bun:test";
import {
  CHECKLIST_UNRESOLVED_GUARD,
  checklistFromCompletion,
  checklistReconciliationOf,
  checklistUnresolvedLine,
  checklistUnresolvedOfGuard,
  closuresById,
  runNotesFromStorage,
  runNotesOf,
  runNotesWorthShowing,
  terminalAuthorityOf,
  terminalAuthorityView,
  turnOutcomeOf,
  unreadResultsNoteOf,
  unresolvedById,
} from "../src/index.js";

// The real shape of `result.metadata.extensions.checklist` (reasoning `ChecklistReconciliation`).
const RECONCILIATION = {
  total: 5,
  done: 3,
  closedByHarness: [
    { id: "1", title: "Search the web", provenance: "harness:evidence", toolCallId: "call-7" },
    { id: "4", title: "Write the report", provenance: "harness:answer" },
  ],
  unresolved: [
    { id: "2", title: "Check the pricing page", status: "pending", reason: "no evidence" },
    { id: "5", title: "Email the summary", status: "in_progress", reason: "no evidence" },
  ],
};

const streamCompleted = (extensions: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  _tag: "StreamCompleted",
  output: "done",
  success: true,
  metadata: { duration: 1, cost: 0, tokensUsed: 0, stepsCount: 1, extensions },
  ...extra,
});

describe("checklist reconciliation (extensions.checklist)", () => {
  it("reads counts, harness closures with provenance and unresolved rows with reasons", () => {
    const view = checklistFromCompletion(streamCompleted({ checklist: RECONCILIATION }));
    expect(view?.label).toBe("3/5");
    expect(view?.closed.map((c) => [c.id, c.kind])).toEqual([["1", "evidence"], ["4", "answer"]]);
    expect(view?.closed[0]?.toolCallId).toBe("call-7");
    expect(view?.closed[0]?.label).toContain("tool result");
    expect(view?.closed[1]?.label).toContain("answer");
    expect(view?.unresolved.map((u) => [u.id, u.status, u.reasonLabel])).toEqual([
      ["2", "pending", "no evidence recorded"],
      ["5", "in_progress", "no evidence recorded"],
    ]);
    expect(checklistUnresolvedLine(view!)).toBe("2 of 5 to-do rows ended with no evidence");
  });

  it("degrades on an unknown provenance and an unknown reason instead of failing", () => {
    const view = checklistReconciliationOf({
      total: 2,
      done: 1,
      closedByHarness: [{ id: "1", title: "A", provenance: "harness:telepathy" }],
      unresolved: [{ id: "2", title: "B", status: "blocked", reason: "tool refused" }],
    });
    expect(view?.closed[0]).toMatchObject({ kind: "other", provenance: "harness:telepathy", label: "closed by the harness" });
    expect(view?.unresolved[0]).toMatchObject({ status: "pending", reason: "tool refused", reasonLabel: "tool refused" });
  });

  it("returns undefined for an absent or malformed record and drops malformed rows", () => {
    expect(checklistFromCompletion(streamCompleted({}))).toBeUndefined();
    expect(checklistReconciliationOf({ total: "5", done: 1 })).toBeUndefined();
    expect(checklistReconciliationOf({ total: 2, done: 1, closedByHarness: [{ title: "no id", provenance: "x" }, 7], unresolved: null })?.closed).toEqual([]);
  });

  it("keys closures and unresolved rows by id for the to-do dock", () => {
    const view = checklistReconciliationOf(RECONCILIATION);
    expect(Object.keys(closuresById(view))).toEqual(["1", "4"]);
    expect(Object.keys(unresolvedById(view))).toEqual(["2", "5"]);
    expect(closuresById(undefined)).toEqual({});
  });

  it("reads the checklist-unresolved guard's metadata, and nothing from another guard", () => {
    const meta = { unresolved: RECONCILIATION.unresolved, done: 3, total: 5 };
    const view = checklistUnresolvedOfGuard({ guard: CHECKLIST_UNRESOLVED_GUARD, metadata: meta });
    expect(view?.unresolved).toHaveLength(2);
    expect(view?.label).toBe("3/5");
    expect(checklistUnresolvedOfGuard({ guard: "plan_budget_raised", metadata: meta })).toBeUndefined();
    expect(checklistUnresolvedOfGuard({ guard: CHECKLIST_UNRESOLVED_GUARD, metadata: { unresolved: [], done: 1, total: 1 } })).toBeUndefined();
    expect(checklistUnresolvedOfGuard({ guard: CHECKLIST_UNRESOLVED_GUARD })).toBeUndefined();
  });
});

describe("unread-results synthesis note", () => {
  it("reads metadata.unreadResultsSynthesis (the framework's record)", () => {
    const note = unreadResultsNoteOf({ metadata: { unreadResultsSynthesis: { unread: 2, tools: ["web-search", "http-get"], outcome: "synthesized" } } });
    expect(note).toMatchObject({ count: 2, tools: ["web-search", "http-get"], outcome: "synthesized" });
    expect(note?.text).toBe("The answer was written from tool results the model had not read.");
  });

  it("reads the harness signal from receipt.interventions and from reasoningSteps", () => {
    const intervention = {
      actor: "unread-results-synthesis",
      authorityClass: "deterministic",
      evidence: "unread: web-search, http-get",
      whatChanged: "unread-results-synthesis: answer synthesized over the task, the pass's tool results and the draft",
      iter: 6,
    };
    const fromReceipt = unreadResultsNoteOf({ receipt: { interventions: [{ actor: "exit-gate" }, intervention] } });
    expect(fromReceipt).toMatchObject({ count: 2, tools: ["web-search", "http-get"], outcome: "synthesized" });
    const fromSteps = unreadResultsNoteOf({ metadata: { reasoningSteps: [{ type: "thought" }, { type: "harness_signal", metadata: { intervention } }] } });
    expect(fromSteps?.outcome).toBe("synthesized");
    const kept = unreadResultsNoteOf({
      receipt: { interventions: [{ ...intervention, whatChanged: "unread-results-synthesis: synthesis returned nothing usable; the earlier draft ships" }] },
    });
    expect(kept?.outcome).toBe("draft-kept");
    const skipped = unreadResultsNoteOf({
      receipt: { interventions: [{ ...intervention, whatChanged: "unread-results-synthesis: synthesis skipped (run budget exhausted); the earlier draft ships" }] },
    });
    expect(skipped?.outcome).toBe("skipped");
  });

  it("degrades an unknown outcome and ignores runs the rule did not touch", () => {
    expect(unreadResultsNoteOf({ metadata: { unreadResultsSynthesis: { unread: 1, tools: ["x"], outcome: "future-outcome" } } })?.outcome).toBe("unknown");
    expect(unreadResultsNoteOf({ receipt: { interventions: [{ actor: "exit-gate", evidence: "e", whatChanged: "w" }] }, metadata: { reasoningSteps: [] } })).toBeUndefined();
    expect(unreadResultsNoteOf({})).toBeUndefined();
  });
});

describe("terminal authority (strategy-accepted)", () => {
  it("reads strategy-accepted as an accepted finish", () => {
    const v = terminalAuthorityView("strategy-accepted");
    expect(v).toMatchObject({ tone: "accepted", label: "Accepted by the strategy" });
    expect(v?.text).toContain("accepted");
  });

  it("degrades an unknown authority to a neutral label with no note text", () => {
    expect(terminalAuthorityView("guard:fabrication-check")).toEqual({ authority: "guard:fabrication-check", label: "guard fabrication check", tone: "neutral" });
    expect(terminalAuthorityView("brand-new-authority")?.tone).toBe("neutral");
    expect(terminalAuthorityView("")).toBeUndefined();
    expect(terminalAuthorityView(undefined)).toBeUndefined();
  });

  it("finds the authority on AgentCompleted.outcome and on a StreamCompleted's extensions", () => {
    expect(terminalAuthorityOf({ outcome: { status: "completed", authority: "strategy-accepted" } })).toBe("strategy-accepted");
    expect(terminalAuthorityOf({ metadata: { extensions: { terminalOutcome: { authority: "strategy-accepted" } } } })).toBe("strategy-accepted");
    expect(terminalAuthorityOf({ outcome: "success" })).toBeUndefined();
  });

  it("a run the strategy accepted ends succeeded, never failed, and carries its authority", () => {
    const agentCompleted = { success: true, terminatedBy: "max_iterations", outcome: { status: "completed", terminatedBy: "max_iterations", authority: "strategy-accepted" } };
    expect(turnOutcomeOf(agentCompleted)).toMatchObject({ ending: "succeeded", authority: "strategy-accepted" });
    const streamed = streamCompleted({ terminalOutcome: { authority: "strategy-accepted" } }, { outcome: "success", terminatedBy: "end_turn" });
    expect(turnOutcomeOf(streamed)).toMatchObject({ ending: "succeeded", authority: "strategy-accepted" });
  });

  it("an unknown authority never changes how a run ended", () => {
    expect(turnOutcomeOf({ success: false, error: "boom", outcome: { status: "failed", authority: "from-the-future" } })).toMatchObject({
      ending: "failed",
      authority: "from-the-future",
    });
    expect(turnOutcomeOf({ success: true, outcome: { authority: "from-the-future" } }).ending).toBe("succeeded");
  });
});

describe("runNotesOf and storage", () => {
  const completion = streamCompleted(
    { checklist: RECONCILIATION, terminalOutcome: { authority: "strategy-accepted" } },
    { receipt: { interventions: [{ actor: "unread-results-synthesis", evidence: "unread: web-search", whatChanged: "unread-results-synthesis: answer synthesized over x" }] } },
  );

  it("collects all three notes and survives a JSON round trip (a reloaded turn)", () => {
    const notes = runNotesOf(completion);
    expect(notes?.checklist?.label).toBe("3/5");
    expect(notes?.unread?.outcome).toBe("synthesized");
    expect(notes?.authority).toBe("strategy-accepted");
    const reloaded = runNotesFromStorage(JSON.parse(JSON.stringify(notes)));
    expect(reloaded).toEqual(notes);
    expect(reloaded?.checklist?.closed[1]?.kind).toBe("answer");
    expect(reloaded?.checklist?.unresolved[0]?.reasonLabel).toBe("no evidence recorded");
  });

  it("reads nothing from a run that reported no notes, and from malformed storage", () => {
    expect(runNotesOf({ metadata: { duration: 1 } })).toBeUndefined();
    expect(runNotesFromStorage(undefined)).toBeUndefined();
    expect(runNotesFromStorage("nope")).toBeUndefined();
    expect(runNotesFromStorage({ checklist: { total: "x" }, unread: 5, authority: 3 })).toBeUndefined();
    expect(runNotesFromStorage({ authority: "an-unknown-authority" })).toEqual({ authority: "an-unknown-authority" });
  });

  it("decides what is worth a line: unresolved rows, closures, an unread note or an accepted finish", () => {
    expect(runNotesWorthShowing(runNotesOf(completion))).toBe(true);
    expect(runNotesWorthShowing(runNotesOf(streamCompleted({ checklist: { total: 2, done: 2, closedByHarness: [], unresolved: [] } })))).toBe(false);
    expect(runNotesWorthShowing(runNotesOf(streamCompleted({ terminalOutcome: { authority: "model-final" } })))).toBe(false);
    expect(runNotesWorthShowing(runNotesOf(streamCompleted({ terminalOutcome: { authority: "strategy-accepted" } })))).toBe(true);
    expect(runNotesWorthShowing(undefined)).toBe(false);
  });
});
