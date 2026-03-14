import { describe, test, expect } from "bun:test";
import { computeSemanticEntropy } from "../../src/sensor/semantic-entropy.js";

describe("semantic entropy (1C)", () => {
  test("returns unavailable when no embeddings", () => {
    const result = computeSemanticEntropy({
      currentEmbedding: null,
      taskEmbedding: null,
      priorEmbeddings: [],
      centroid: null,
    });
    expect(result.available).toBe(false);
    expect(result.taskAlignment).toBe(0);
    expect(result.noveltyScore).toBe(0);
    expect(result.adjacentRepetition).toBe(0);
  });

  test("high task alignment when current embedding close to task", () => {
    const current = [1, 0, 0];
    const task = [0.9, 0.1, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: task,
      priorEmbeddings: [],
      centroid: null,
    });
    expect(result.available).toBe(true);
    expect(result.taskAlignment).toBeGreaterThan(0.9);
  });

  test("low novelty when current is similar to centroid (repetition)", () => {
    const current = [1, 0, 0];
    const centroid = [0.99, 0.01, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: [1, 0, 0],
      priorEmbeddings: [[1, 0, 0]],
      centroid,
    });
    expect(result.noveltyScore).toBeLessThan(0.1); // very similar to centroid
  });

  test("high novelty when current diverges from centroid", () => {
    const current = [0, 1, 0]; // orthogonal
    const centroid = [1, 0, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: [0.5, 0.5, 0],
      priorEmbeddings: [[1, 0, 0]],
      centroid,
    });
    expect(result.noveltyScore).toBeGreaterThan(0.8);
  });

  test("high adjacent repetition when last two thoughts are near-identical", () => {
    const current = [1, 0, 0];
    const prior = [0.99, 0.01, 0];
    const result = computeSemanticEntropy({
      currentEmbedding: current,
      taskEmbedding: [1, 0, 0],
      priorEmbeddings: [prior],
      centroid: prior,
    });
    expect(result.adjacentRepetition).toBeGreaterThan(0.95);
  });
});
