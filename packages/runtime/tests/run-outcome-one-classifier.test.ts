// Run: bun test packages/runtime/tests/run-outcome-one-classifier.test.ts
//
// ONE run-outcome classifier, and the whole truth table written down.
//
// There were two. `deriveRunOutcome` (engine/util.ts) fed telemetry, the trust
// receipt lane and the procedural-learning loop; `deriveOutcome` (debrief.ts)
// fed the after-action record. Same two inputs, independent implementations.
//
// Enumerating the cross product — twelve cases, both functions pure, so it
// costs nothing — showed they disagreed on FOUR. The register had logged one:
//
//   terminatedBy         errors   engine     debrief
//   final_answer_tool    yes      success    partial
//   final_answer         yes      success    partial
//   end_turn             yes      failure    partial
//   llm_error            no       success    failure     <- the logged bug
//
// So a run could be a success in telemetry and a partial in its own debrief,
// and nobody would see it because nothing compared them. Reading the two
// functions side by side had surfaced only the `llm_error` case; the other
// three needed the table.
//
// Resolved POINTWISE-CONSERVATIVE: where they disagreed, the harsher verdict
// wins. That direction matters — these are honesty surfaces, and the trust
// receipt already holds the same rule (a shared verdict may move DOWN, never
// up), so unification cannot manufacture a better-looking run than either lane
// produced before. Three of the four were genuine semantic splits where either
// reading was arguable. The fourth was a bug: a provider failure scored as a
// clean win, and `recordOutcome(skillId, outcome !== "failure")` then CREDITED
// the procedural skill that led the agent into it.
import { describe, expect, it } from "bun:test";
import type { TerminatedBy } from "@reactive-agents/core";
import { deriveRunOutcome } from "../src/engine/util.js";
import { __testOnlyDeriveDebriefOutcome } from "../src/debrief.js";

/** Every (terminatedBy × hadErrors) case and its single agreed verdict. */
const TRUTH_TABLE: ReadonlyArray<{
  readonly terminatedBy: TerminatedBy;
  readonly hadErrors: boolean;
  readonly outcome: "success" | "partial" | "failure";
}> = [
  // Clean finishes with nothing wrong.
  { terminatedBy: "final_answer_tool", hadErrors: false, outcome: "success" },
  { terminatedBy: "final_answer", hadErrors: false, outcome: "success" },
  { terminatedBy: "end_turn", hadErrors: false, outcome: "success" },

  // Explicitly finished, but errors happened on the way: the agent recovered
  // and delivered. "partial" — saying "success" overstates the run.
  { terminatedBy: "final_answer_tool", hadErrors: true, outcome: "partial" },
  { terminatedBy: "final_answer", hadErrors: true, outcome: "partial" },

  // Stopped without claiming an answer while errors were outstanding.
  { terminatedBy: "end_turn", hadErrors: true, outcome: "failure" },

  // Ran out of room. Incomplete, but nothing failed.
  { terminatedBy: "max_iterations", hadErrors: false, outcome: "partial" },
  { terminatedBy: "max_iterations", hadErrors: true, outcome: "partial" },

  // A provider failure is never a success — including when the loop happened
  // to collect no error strings, which is exactly how it used to score one.
  { terminatedBy: "llm_error", hadErrors: false, outcome: "failure" },
  { terminatedBy: "llm_error", hadErrors: true, outcome: "failure" },

  // The agent honestly declined. Not a success: nothing was delivered, and it
  // must never be reinforced as one. The honesty of the decline is carried by
  // AgentResult.abstention and the receipt, not by this coarse enum.
  { terminatedBy: "abstained", hadErrors: false, outcome: "failure" },
  { terminatedBy: "abstained", hadErrors: true, outcome: "failure" },
];

describe("deriveRunOutcome — the whole truth table", () => {
  it("covers every terminatedBy member (a new member must land here)", () => {
    // Guards the gap that caused the original defect: `"abstained"` was missing
    // from the union these classifiers were written against, so the case they
    // had to handle was one the type said could not occur.
    const covered = new Set(TRUTH_TABLE.map((r) => r.terminatedBy));
    expect([...covered].sort()).toEqual([
      "abstained",
      "end_turn",
      "final_answer",
      "final_answer_tool",
      "llm_error",
      "max_iterations",
    ]);
    expect(TRUTH_TABLE.length).toBe(covered.size * 2);
  });

  for (const row of TRUTH_TABLE) {
    it(`${row.terminatedBy} + ${row.hadErrors ? "errors" : "no errors"} → ${row.outcome}`, () => {
      expect(deriveRunOutcome(row.terminatedBy, row.hadErrors)).toBe(row.outcome);
    });
  }
});

describe("the debrief lane is the SAME classifier, only relabelled", () => {
  for (const row of TRUTH_TABLE) {
    it(`${row.terminatedBy} + ${row.hadErrors ? "errors" : "no errors"} agrees`, () => {
      // The debrief vocabulary says "failed" where the canonical enum says
      // "failure". Everything else must match exactly — a second opinion here
      // is the drift this file exists to prevent.
      const expected = row.outcome === "failure" ? "failed" : row.outcome;
      const errors = row.hadErrors ? ["boom"] : [];
      expect(__testOnlyDeriveDebriefOutcome(row.terminatedBy, errors)).toBe(expected);
    });
  }
});
