import { describe, test, expect } from "bun:test";
import { computeTokenEntropy } from "../../src/sensor/token-entropy.js";

describe("token entropy (1A)", () => {
  test("returns null when no logprobs provided", () => {
    const result = computeTokenEntropy(undefined);
    expect(result).toBeNull();
  });

  test("returns null when logprobs is empty", () => {
    const result = computeTokenEntropy([]);
    expect(result).toBeNull();
  });

  test("computes low entropy for confident tokens (single dominant logprob)", () => {
    // All tokens have one dominant probability → low entropy
    const logprobs = [
      { token: "Paris", logprob: -0.01, topLogprobs: [
        { token: "Paris", logprob: -0.01 },
        { token: "London", logprob: -5.0 },
        { token: "Berlin", logprob: -6.0 },
      ]},
      { token: "is", logprob: -0.02, topLogprobs: [
        { token: "is", logprob: -0.02 },
        { token: "was", logprob: -4.0 },
        { token: "has", logprob: -5.0 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.sequenceEntropy).toBeLessThan(0.2);
    expect(result!.peakEntropy).toBeLessThan(0.2);
    expect(result!.tokenEntropies).toHaveLength(2);
  });

  test("computes high entropy for uncertain tokens (uniform distribution)", () => {
    // All tokens have nearly uniform distribution → high entropy
    const logprobs = [
      { token: "maybe", logprob: -1.1, topLogprobs: [
        { token: "maybe", logprob: -1.1 },
        { token: "perhaps", logprob: -1.2 },
        { token: "possibly", logprob: -1.3 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    expect(result!.sequenceEntropy).toBeGreaterThan(0.8);
  });

  test("detects entropy spikes above threshold", () => {
    const logprobs = [
      // Low entropy token
      { token: "The", logprob: -0.01, topLogprobs: [
        { token: "The", logprob: -0.01 },
        { token: "A", logprob: -5.0 },
      ]},
      // High entropy token (spike)
      { token: "answer", logprob: -1.0, topLogprobs: [
        { token: "answer", logprob: -1.0 },
        { token: "result", logprob: -1.1 },
        { token: "solution", logprob: -1.2 },
      ]},
      // Low entropy token
      { token: "is", logprob: -0.02, topLogprobs: [
        { token: "is", logprob: -0.02 },
        { token: "was", logprob: -4.0 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs, 0.7);
    expect(result).not.toBeNull();
    expect(result!.entropySpikes.length).toBeGreaterThanOrEqual(1);
    expect(result!.entropySpikes[0].position).toBe(1); // second token
  });

  test("sequenceEntropy is length-normalized mean of per-token entropies", () => {
    const logprobs = [
      { token: "a", logprob: -0.5, topLogprobs: [
        { token: "a", logprob: -0.5 },
        { token: "b", logprob: -1.0 },
      ]},
      { token: "c", logprob: -0.1, topLogprobs: [
        { token: "c", logprob: -0.1 },
        { token: "d", logprob: -3.0 },
      ]},
    ];
    const result = computeTokenEntropy(logprobs);
    expect(result).not.toBeNull();
    const expectedMean = (result!.tokenEntropies[0] + result!.tokenEntropies[1]) / 2;
    expect(result!.sequenceEntropy).toBeCloseTo(expectedMean, 5);
  });
});
