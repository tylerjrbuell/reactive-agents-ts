import { describe, expect, it } from "bun:test";
import {
  calibrationNote,
  calibrationRows,
  costStats,
  entropyStats,
  observationLine,
  observationStats,
  type ModelCalibrationView,
  type ModelCost,
  type ObservationSummary,
} from "./model-insights.js";

const obs = (over: Partial<ObservationSummary> = {}): ObservationSummary => ({
  sampleCount: 0,
  runs: 0,
  window: 50,
  threshold: 5,
  parallelRuns: 0,
  classifierMissRuns: 0,
  actOrAnswerRuns: 0,
  forcedCalls: 0,
  forcedCallsSucceeded: 0,
  noCallStallTurns: 0,
  unforcedToolWorkTurns: 0,
  ...over,
});

const view = (over: Partial<ModelCalibrationView> = {}): ModelCalibrationView => ({
  model: "qwen3:4b",
  status: "prior",
  prior: { calibratedAt: "2026-10-15T01:30:14.880Z", runsAveraged: 10, probeVersion: 2 },
  settings: [
    { key: "optimalToolResultChars", value: 2000, source: "shipped" },
    { key: "parallelCallCapability", value: "sequential-only", priorValue: "reliable", source: "learned" },
    { key: "actOrAnswer", value: "retry", source: "shipped" },
  ],
  observations: obs(),
  entropy: null,
  bandit: null,
  ...over,
});

const cost = (over: Partial<ModelCost> = {}): ModelCost => ({
  runs: 4,
  successfulRuns: 2,
  calls: 6,
  tokens: 12_000,
  tokensIn: 9_000,
  tokensOut: 3_000,
  cachedTokensIn: 0,
  splitCalls: 6,
  costUsd: 0.05,
  costKnown: true,
  costPerSuccessfulRun: 0.025,
  ...over,
});

describe("model calibration rows", () => {
  it("names each setting in plain words and says where it came from", () => {
    const rows = calibrationRows(view());
    expect(rows.map((r) => [r.label, r.value, r.sourceLabel])).toEqual([
      ["Tool result size", "2,000 characters", "Shipped calibration"],
      ["Parallel tool calls", "One at a time", "Learned from your runs (shipped: Batches calls)"],
      ["Act or answer", "Ask for a tool call after a miss", "Shipped calibration"],
    ]);
    expect(rows[1]!.raw).toBe("sequential-only");
    expect(rows.every((r) => r.help.length > 0)).toBe(true);
  });

  it("the note counts learned settings, and says when there is no calibration at all", () => {
    expect(calibrationNote(view())).toContain("1 setting learned from your runs.");
    expect(calibrationNote(view())).toContain("over 10 probe runs");
    expect(calibrationNote(view({ settings: [{ key: "actOrAnswer", value: "retry", source: "shipped" }] }))).toContain(
      "Your runs have not changed any setting.",
    );
    expect(calibrationNote(view({ status: "none", settings: [] }))).toContain("runs use the harness defaults");
  });
});

describe("observations", () => {
  it("says how many runs were seen and when learning starts", () => {
    expect(observationLine(obs())).toBe("No runs observed on this model yet.");
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(observationLine(obs({ sampleCount: 3, runs: 3, lastAt: "2026-11-11T11:00:00Z" }), now)).toBe(
      "3 runs observed, last 1 hour ago; learning starts at 5.",
    );
    expect(observationLine(obs({ sampleCount: 60, runs: 50 }), now)).toBe("60 runs observed (the last 50 kept); enough to learn from.");
  });

  it("shows act-or-answer counts only when runs recorded them", () => {
    expect(observationStats(obs())).toEqual([]);
    expect(observationStats(obs({ runs: 6, parallelRuns: 1 })).map((s) => s.label)).toEqual(["Parallel turns", "Classifier misses"]);
    const withAoa = observationStats(obs({ runs: 6, actOrAnswerRuns: 5, forcedCalls: 4, forcedCallsSucceeded: 3, noCallStallTurns: 2, unforcedToolWorkTurns: 20 }));
    expect(withAoa.find((s) => s.label === "Forced calls that worked")?.value).toBe("3 of 4");
    expect(withAoa.find((s) => s.label === "Stalled turns")?.value).toBe("2 of 20");
  });

  it("entropy thresholds read as stats, none when the sensor stored nothing", () => {
    expect(entropyStats(null)).toEqual([]);
    const s = entropyStats({ sampleCount: 24, calibrated: true, highEntropyThreshold: 0.712, convergenceThreshold: 0.18, driftDetected: false, lastUpdated: 0 });
    expect(s.map((x) => [x.label, x.value])).toEqual([
      ["Scored steps", "24"],
      ["Uncertain above", "0.71"],
      ["Settled below", "0.18"],
      ["Drift", "none"],
    ]);
  });
});

describe("spend", () => {
  it("lists spend, per-success, tokens and the split", () => {
    expect(costStats(cost()).map((s) => [s.label, s.value])).toEqual([
      ["Spend", "$0.050"],
      ["Per successful run", "$0.025"],
      ["Tokens", "12k"],
      ["Input", "9k"],
      ["Output", "3k"],
    ]);
  });

  it("marks a lower bound when a call was unpriced, and shows cached input when any", () => {
    const s = costStats(cost({ costKnown: false, cachedTokensIn: 4_000 }));
    expect(s[0]!.value).toBe("≥ $0.050");
    expect(s[0]!.title).toContain("at least");
    expect(s.find((x) => x.label === "Cached input")?.value).toBe("4k");
  });

  it("no successful run: a dash, never a division by zero; no calls: nothing", () => {
    const s = costStats(cost({ successfulRuns: 0, costPerSuccessfulRun: undefined }));
    expect(s.find((x) => x.label === "Per successful run")?.value).toBe("—");
    expect(costStats(cost({ calls: 0 }))).toEqual([]);
    expect(costStats(null)).toEqual([]);
  });
});
