// Quality program Task 12 (seam breadth, GH #260): direct-import pins for the
// #219 pure-helper modules. tool-index-disclosure is already seeded by
// kernel/reason/tool-index-text.test.ts (typed fixture, count/cap matrix); the
// pressure predicate and the surface stage are seeded by think-pressure-gate
// and seam-resolve-think-surface. The remaining unseeded pure seam: the two
// prose classifiers the dispatch-stage auto-promotion short-circuits compose.
// They decide "is this answer trustworthy as complete WITHOUT a tool call" —
// a false negative strands real answers in a re-run loop; a false positive
// promotes planning monologue as final. Pins are behavioral truth tables of
// the length bar, the planning-pattern blocklist (modal verbs ONLY:
// word-boundary discipline means "I may call..." inside a real answer is NOT
// planning), and the structural positive signals.

import { describe, it, expect } from "bun:test";
import {
  looksLikeCompleteProse,
  looksLikeFinalAnswer,
} from "../../src/kernel/capabilities/reason/final-answer-heuristics.js";

const PLAIN_PROSE =
  "The current population of France is approximately 68 million people, " +
  "according to the latest official census data published by the national " +
  "statistics institute earlier this spring after a full recount.";

const PLANNING_MONOLOGUE =
  "I will call the search tool to look up the population figure and then " +
  "check the returned result carefully to make sure it is current before " +
  "I compose the final response for the user with the numbers.";

const STRUCTURED_ANSWER =
  "## France: Population Summary\n\n" +
  "The answer is approximately 68 million residents as of the latest " +
  "official census release.\n\n" +
  "1. Metro areas account for roughly two thirds\n" +
  "2. The figure is updated annually by the statistics institute";

describe("final-answer heuristics (seam #260 breadth)", () => {
  it("looksLikeCompleteProse: length bar, planning blocklist, modal-verb discipline", () => {
    expect(looksLikeCompleteProse(PLAIN_PROSE)).toBe(true); // 100+, no blocklist match
    expect(looksLikeCompleteProse("Paris is nice.")).toBe(false); // under the bar
    expect(looksLikeCompleteProse(PLANNING_MONOLOGUE)).toBe(false); // "I will call" fires
    // vocabulary discipline: the blocklist's modals are should|need to|will|
    // am going to|'ll|'m going to — "may" is NOT planning, so this stays true
    expect(
      looksLikeCompleteProse(
        PLAIN_PROSE + " I may call the census office for the methodology appendix.",
      ),
    ).toBe(true);
  });

  it("looksLikeFinalAnswer: structural signal required; planning pattern vetoes first", () => {
    expect(looksLikeFinalAnswer(PLAIN_PROSE)).toBe(false); // prose, no structure
    expect(looksLikeFinalAnswer(STRUCTURED_ANSWER)).toBe(true); // header + numbered list
    expect(looksLikeFinalAnswer(PLANNING_MONOLOGUE)).toBe(false); // vetoed by pattern
    expect(
      looksLikeFinalAnswer(
        "In summary, the census figures show a clear upward trend across the " +
          "last four reporting quarters of the national statistics series.",
      ),
    ).toBe(true); // "in summary" phrase signal
  });
});
