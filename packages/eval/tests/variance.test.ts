import { describe, it, expect } from "bun:test";
import {
  mean,
  sampleStddev,
  standardError,
  confidenceInterval95,
  minimumDetectableEffect,
  summarizeRepeats,
  pooledStats,
  checkCalibration,
} from "../src/stats/variance.js";

describe("variance stats", () => {
  it("mean/sampleStddev on a known dataset", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBeCloseTo(5);
    expect(sampleStddev(xs)).toBeCloseTo(2.138, 2); // textbook example, sample stddev
  });

  it("a single sample has zero spread (undefined, not NaN or Infinity)", () => {
    expect(sampleStddev([0.8])).toBe(0);
    expect(standardError([0.8])).toBe(0);
  });

  it("empty input never throws or produces NaN — mean is 0", () => {
    expect(mean([])).toBe(0);
    expect(sampleStddev([])).toBe(0);
  });

  it("confidenceInterval95 widens with more spread and narrows with more samples", () => {
    const tight = confidenceInterval95([0.8, 0.8, 0.81, 0.79, 0.8]);
    const wide = confidenceInterval95([0.2, 0.8, 0.5, 0.9, 0.1]);
    expect(tight[1] - tight[0]).toBeLessThan(wide[1] - wide[0]);

    const fewSamples = confidenceInterval95([0.5, 0.7]);
    const manySamples = confidenceInterval95(Array(20).fill(0).map((_, i) => 0.5 + (i % 2 === 0 ? 0.1 : -0.1)));
    expect(manySamples[1] - manySamples[0]).toBeLessThan(fewSamples[1] - fewSamples[0]);
  });

  it("minimumDetectableEffect shrinks as sample size grows (more repeats -> smaller detectable delta)", () => {
    const mdeSmallN = minimumDetectableEffect(0.1, 5, 0.1, 5);
    const mdeLargeN = minimumDetectableEffect(0.1, 30, 0.1, 30);
    expect(mdeLargeN).toBeLessThan(mdeSmallN);
  });

  it("minimumDetectableEffect is 0 for two perfectly steady (zero-variance) sides", () => {
    expect(minimumDetectableEffect(0, 10, 0, 10)).toBe(0);
  });

  it("summarizeRepeats matches the individual functions", () => {
    const xs = [0.9, 0.85, 0.92, 0.88];
    const stats = summarizeRepeats(xs);
    expect(stats.mean).toBeCloseTo(mean(xs));
    expect(stats.stddev).toBeCloseTo(sampleStddev(xs));
    expect(stats.n).toBe(4);
  });

  it("checkCalibration: perfectly calibrated predictions land near the diagonal", () => {
    // 10 items at p=0.9, 9 of them correct -> observedRate ~0.9 in that bucket.
    const labeled = [
      ...Array(9).fill({ probability: 0.9, correct: true }),
      { probability: 0.9, correct: false },
    ];
    const buckets = checkCalibration(labeled, 5);
    const hitBucket = buckets.find((b) => b.n > 0);
    expect(hitBucket?.predictedMean).toBeCloseTo(0.9);
    expect(hitBucket?.observedRate).toBeCloseTo(0.9);
  });

  it("checkCalibration: overconfident predictions show a gap between predicted and observed", () => {
    // Model says p=0.95 every time, but it's only right half the time -- miscalibrated.
    const labeled = [
      { probability: 0.95, correct: true },
      { probability: 0.95, correct: false },
      { probability: 0.95, correct: true },
      { probability: 0.95, correct: false },
    ];
    const buckets = checkCalibration(labeled, 5);
    const hitBucket = buckets.find((b) => b.n > 0);
    expect(hitBucket?.predictedMean).toBeCloseTo(0.95);
    expect(hitBucket?.observedRate).toBeCloseTo(0.5);
    expect(Math.abs((hitBucket?.predictedMean ?? 0) - (hitBucket?.observedRate ?? 0))).toBeGreaterThan(0.3);
  });

  it("pooledStats: two zero-noise cases with a real quality gap pool to stddev 0, NOT the gap's spread — the code-review fix (2026-09-22)", () => {
    // Case A: judge answers 0.95 every single repeat (zero judge noise).
    // Case B: judge answers 0.60 every single repeat (zero judge noise).
    // These are genuinely different-quality outputs, not judge flakiness —
    // pooling them via flat concatenation would report ~0.175 stddev
    // (dominated by the 0.35 case-to-case gap), which is wrong: there is
    // ZERO judge noise here to detect.
    const caseA = summarizeRepeats([0.95, 0.95, 0.95, 0.95, 0.95]);
    const caseB = summarizeRepeats([0.6, 0.6, 0.6, 0.6, 0.6]);
    const pooled = pooledStats([caseA, caseB]);

    expect(pooled.stddev).toBe(0); // within-case noise is genuinely zero
    expect(pooled.n).toBe(10); // total samples, not case count
    expect(pooled.mean).toBeCloseTo((0.95 + 0.6) / 2); // still reports the honest grand mean
  });

  it("pooledStats: real judge noise within cases is preserved, not washed out by pooling", () => {
    const caseA = summarizeRepeats([0.9, 0.85, 0.95, 0.88, 0.92]);
    const caseB = summarizeRepeats([0.5, 0.45, 0.55, 0.48, 0.52]);
    const pooled = pooledStats([caseA, caseB]);

    expect(pooled.stddev).toBeGreaterThan(0);
    // Pooled within-group stddev should be close to each case's own
    // (similar spread in both) -- not inflated by their 0.4 mean gap.
    expect(pooled.stddev).toBeLessThan(0.4);
  });

  it("pooledStats: groups with a single sample (n<2, no defined spread) still contribute their mean, not their absent variance", () => {
    const singleSample = summarizeRepeats([0.8]);
    const fiveSamples = summarizeRepeats([0.7, 0.72, 0.68, 0.71, 0.69]);
    const pooled = pooledStats([singleSample, fiveSamples]);

    expect(pooled.n).toBe(6);
    expect(pooled.stddev).toBeGreaterThan(0); // driven entirely by the 5-sample group
    expect(pooled.mean).toBeCloseTo((0.8 + 0.7 + 0.72 + 0.68 + 0.71 + 0.69) / 6);
  });

  it("pooledStats: empty input never throws or produces NaN", () => {
    const pooled = pooledStats([]);
    expect(pooled).toEqual({ mean: 0, stddev: 0, n: 0, ci95: [0, 0] });
  });

  it("checkCalibration: empty buckets have n:0 and mean:0, never NaN", () => {
    const buckets = checkCalibration([{ probability: 0.1, correct: true }], 5);
    const empty = buckets.filter((b) => b.n === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const b of empty) {
      expect(b.predictedMean).toBe(0);
      expect(b.observedRate).toBe(0);
    }
  });
});
