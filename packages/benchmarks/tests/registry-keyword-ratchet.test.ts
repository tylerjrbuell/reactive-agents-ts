// Run: bun test packages/benchmarks/tests/registry-keyword-ratchet.test.ts
//
// RATCHET (mirrors the feature-coverage ratchet in feature-coverage.test.ts).
//
// A task scored by a bare `expected:` keyword regex has a binary Bernoulli
// accuracy cell (sd 0.50) AND grades keyword presence rather than correctness.
// The 2026-07-11 keyword→graded wave (mission W-K) converted the tasks whose
// correctness is deterministically checkable to graded `verifiable` hidden
// checks; the rest are honest remainder (single-fact recall, tool-pipeline
// output strings, open-ended design — see task-registry.ts for the per-class
// reasons).
//
// This pin holds the line: the count of keyword-scored tasks MAY ONLY DECREASE.
// If it rises, someone added a new `expected:` task or un-converted one — either
// convert it to a graded check or justify it as honest remainder and lower the
// pin in the same change.

import { describe, expect, it } from "bun:test";
import { BENCHMARK_TASKS } from "../src/task-registry.js";

/**
 * The recorded ceiling. Was 25 before this wave; 5 tasks converted to graded
 * `verifiable` hidden checks (s1, s2, m1, m4, c3). Graded generators also exist
 * for m2/m3/e1 but those stay keyword-scored: they belong to no-tool gate
 * sessions whose isolation a file-write requirement would break (Warden
 * 2026-07-11 — see task-registry.ts notes). MAY ONLY DECREASE.
 */
const KEYWORD_SCORED_CEILING = 20;

/** Tasks whose accuracy is still scored by the legacy `expected:` keyword regex. */
function keywordScoredTasks(): ReadonlyArray<string> {
  return BENCHMARK_TASKS.filter(
    // A task is keyword-scored iff it carries `expected` AND has no successCriteria
    // overriding it (judge.ts prefers successCriteria when both are present).
    (t) => t.expected !== undefined && t.successCriteria === undefined,
  ).map((t) => t.id);
}

describe("keyword-scored task count is a RATCHET — it may only shrink", () => {
  it("keyword-scored task count is at or below the recorded ceiling", () => {
    // If this fails UPWARD, a new `expected:`-only task shipped. Convert it to a
    // graded hidden check, or justify it as honest remainder and lower the pin.
    expect(keywordScoredTasks().length).toBeLessThanOrEqual(KEYWORD_SCORED_CEILING);
  });

  it("the ceiling is not stale — lower it when tasks get converted", () => {
    // Keeps the ratchet honest: once the real count drops below the ceiling this
    // fails and forces the constant down, so it can never drift into meaninglessness.
    expect(keywordScoredTasks().length).toBe(KEYWORD_SCORED_CEILING);
  });

  it("no converted task still carries a stale `expected` field", () => {
    // A converted task keeping `expected` would double-declare scoring and mask
    // the ratchet decrease. Every task with a `verifiable` criterion must have
    // shed `expected`.
    const doubleDeclared = BENCHMARK_TASKS.filter(
      (t) => t.successCriteria?.type === "verifiable" && t.expected !== undefined,
    ).map((t) => t.id);
    expect(doubleDeclared).toEqual([]);
  });
});
