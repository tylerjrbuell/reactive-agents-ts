// Run: bun test packages/reactive-intelligence/tests/calibration/observations-merge.act-or-answer.test.ts --timeout 15000
//
// calibration.actOrAnswer is learned from the act-or-answer counts each run
// records (no-call stalls, forced calls, forced calls that succeeded). Runs
// from older observation files carry none of the counts and are ignored.
import { describe, expect, it } from "bun:test";
import { ACT_OR_ANSWER_MIN_UNFORCED_TURNS, deriveActOrAnswer, mergeObservationsIntoPrior } from "../../src/calibration/observations-merge.js";
import type { ModelObservations, RunObservation } from "../../src/calibration/observations-types.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

const prior: ModelCalibration = {
  modelId: "m",
  calibratedAt: "2026-11-06T00:00:00.000Z",
  probeVersion: 1,
  runsAveraged: 3,
  steeringCompliance: "hybrid",
  parallelCallCapability: "sequential-only",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 1500,
  toolCallDialect: "none",
  classifierReliability: "high",
};

interface Counts {
  readonly stalls: number;
  readonly forced: number;
  readonly succeeded: number;
  readonly turns?: number;
  /** Unforced tool-work turns (the stall-rate denominator). Default: `turns`. */
  readonly unforced?: number;
}

const base = (i: number): RunObservation => ({
  at: `2026-11-06T12:${String(i).padStart(2, "0")}:00.000Z`,
  parallelTurnCount: 0,
  totalTurnCount: 10,
  dialect: "native-fc",
  classifierRequired: [],
  classifierActuallyCalled: [],
  subagentInvoked: 0,
  subagentSucceeded: 0,
  argValidityRate: 1,
});

const counted = (c: Counts, i: number): RunObservation => ({
  ...base(i),
  totalTurnCount: c.turns ?? 10,
  noCallStallTurns: c.stalls,
  unforcedToolWorkTurns: c.unforced ?? c.turns ?? 10,
  forcedCalls: c.forced,
  forcedCallsCalled: c.succeeded,
  forcedCallsSucceeded: c.succeeded,
});

const many = (n: number, c: Counts): RunObservation[] => Array.from({ length: n }, (_, i) => counted(c, i));
const obs = (runs: readonly RunObservation[]): ModelObservations => ({ schemaVersion: 1, modelId: "m", sampleCount: runs.length, runs });

describe("deriveActOrAnswer", () => {
  it("under threshold: no learned choice (4 counted runs)", () => {
    expect(deriveActOrAnswer(many(4, { stalls: 3, forced: 3, succeeded: 3 }))).toBeUndefined();
  });

  it("old-format runs (no counts) do not count toward the threshold", () => {
    const runs = [...Array.from({ length: 10 }, (_, i) => base(i)), ...many(4, { stalls: 3, forced: 3, succeeded: 3 })];
    expect(deriveActOrAnswer(runs)).toBeUndefined();
  });

  it("forced calls that mostly fail turn forcing off (>=5 forced, success < 0.4)", () => {
    // 5 runs x 2 forced = 10 forced, 3 succeeded = 0.3; stall rate 0.3 would otherwise say retry/proactive.
    const runs = many(5, { stalls: 3, forced: 2, succeeded: 0 }).map((r, i) => (i < 3 ? { ...r, forcedCallsSucceeded: 1 } : r));
    expect(deriveActOrAnswer(runs)).toBe("off");
  });

  it("a low success rate on fewer than 5 forced calls is noise: not off on that rule", () => {
    // 4 forced total, 0 succeeded, stall rate 0.2 -> retry.
    const runs = many(5, { stalls: 2, forced: 0, succeeded: 0 }).map((r, i) => (i < 4 ? { ...r, forcedCalls: 1 } : r));
    expect(deriveActOrAnswer(runs)).toBe("retry");
  });

  it("almost no stalls (< 0.05 per turn) turns forcing off", () => {
    expect(deriveActOrAnswer(many(5, { stalls: 0, forced: 0, succeeded: 0 }))).toBe("off");
  });

  it("reliable forced calls (>= 0.7) with common stalls (>= 0.15) go proactive", () => {
    expect(deriveActOrAnswer(many(5, { stalls: 2, forced: 2, succeeded: 2 }))).toBe("proactive");
  });

  it("reliable forced calls with rare stalls stay retry; stalls with no forced data are retry", () => {
    expect(deriveActOrAnswer(many(5, { stalls: 1, forced: 2, succeeded: 2 }))).toBe("retry");
    expect(deriveActOrAnswer(many(5, { stalls: 3, forced: 0, succeeded: 0 }))).toBe("retry");
  });

  it("the stall rate is measured over unforced tool-work turns, not all turns", () => {
    // 5 runs x 20 turns, 4 unforced each (20 unforced), 1 stall each: 5/20 = 0.25 -> proactive.
    // Over all turns it would be 5/100 = 0.05 -> retry.
    expect(deriveActOrAnswer(many(5, { stalls: 1, forced: 2, succeeded: 2, turns: 20, unforced: 4 }))).toBe("proactive");
  });

  it("a fully forced proactive history keeps the prior's choice: no proactive -> off/retry flip", () => {
    // Every tool-work turn forced (0 unforced), every forced call succeeds, no stall.
    // Over all turns the stall rate is 0, which would read "off".
    const forcedOnly = many(5, { stalls: 0, forced: 3, succeeded: 3, unforced: 0 });
    expect(deriveActOrAnswer(forcedOnly, "proactive")).toBe("proactive");
    expect(deriveActOrAnswer(forcedOnly, "retry")).toBe("retry");
    expect(deriveActOrAnswer(forcedOnly)).toBeUndefined();
  });

  it(`below ${ACT_OR_ANSWER_MIN_UNFORCED_TURNS} summed unforced turns, the stall-rate rules hold the prior`, () => {
    const few = many(5, { stalls: 1, forced: 2, succeeded: 2, unforced: 1 }); // 5 unforced, rate 1.0
    expect(deriveActOrAnswer(few, "retry")).toBe("retry");
    const enough = many(5, { stalls: 1, forced: 2, succeeded: 2, unforced: 2 }); // 10 unforced, rate 0.5
    expect(deriveActOrAnswer(enough, "retry")).toBe("proactive");
  });

  it("the forced-success off rule still applies with no unforced evidence (it is measured under forcing)", () => {
    expect(deriveActOrAnswer(many(5, { stalls: 0, forced: 2, succeeded: 0, unforced: 0 }), "proactive")).toBe("off");
  });

  it("runs without the unforced count are not counted (older files)", () => {
    const { unforcedToolWorkTurns: _drop, ...rest } = counted({ stalls: 3, forced: 3, succeeded: 3 }, 0);
    expect(deriveActOrAnswer([...Array.from({ length: 5 }, () => rest), ...many(4, { stalls: 3, forced: 3, succeeded: 3 })])).toBeUndefined();
  });
});

describe("mergeObservationsIntoPrior — actOrAnswer", () => {
  it("writes the learned choice onto the calibration", () => {
    expect(mergeObservationsIntoPrior(prior, obs(many(5, { stalls: 2, forced: 2, succeeded: 2 }))).actOrAnswer).toBe("proactive");
  });

  it("returns the prior by identity when the learned choice is unchanged", () => {
    const withChoice: ModelCalibration = { ...prior, actOrAnswer: "proactive" };
    expect(mergeObservationsIntoPrior(withChoice, obs(many(5, { stalls: 2, forced: 2, succeeded: 2 })))).toBe(withChoice);
  });

  it("a fully forced proactive history returns the proactive prior by identity", () => {
    const proactivePrior: ModelCalibration = { ...prior, actOrAnswer: "proactive" };
    expect(mergeObservationsIntoPrior(proactivePrior, obs(many(5, { stalls: 0, forced: 3, succeeded: 3, unforced: 0 })))).toBe(proactivePrior);
  });

  it("old-format observations leave actOrAnswer untouched (prior by identity)", () => {
    const runs = Array.from({ length: 6 }, (_, i) => base(i));
    expect(mergeObservationsIntoPrior(prior, obs(runs))).toBe(prior);
  });
});
