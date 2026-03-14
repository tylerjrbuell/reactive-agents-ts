import type { SemanticEntropy } from "../types.js";
import { cosineSimilarity } from "./math-utils.js";

export type SemanticEntropyInput = {
  currentEmbedding: readonly number[] | null;
  taskEmbedding: readonly number[] | null;
  priorEmbeddings: readonly (readonly number[])[];
  centroid: readonly number[] | null;
};

/**
 * Compute semantic entropy using SelfCheckGPT consistency principle.
 * Compares current thought embedding against task and centroid of priors.
 * Returns { available: false } when embeddings are unavailable.
 */
export function computeSemanticEntropy(input: SemanticEntropyInput): SemanticEntropy {
  const { currentEmbedding, taskEmbedding, priorEmbeddings, centroid } = input;

  if (!currentEmbedding) {
    return { taskAlignment: 0, noveltyScore: 0, adjacentRepetition: 0, available: false };
  }

  // Task alignment: cosine sim to task description
  const taskAlignment = taskEmbedding
    ? cosineSimilarity(currentEmbedding, taskEmbedding)
    : 0;

  // Novelty: 1 - cosine sim to centroid of all prior thoughts
  const noveltyScore = centroid
    ? 1 - cosineSimilarity(currentEmbedding, centroid)
    : 1; // first iteration = fully novel

  // Adjacent repetition: cosine sim to immediately prior thought
  const lastPrior = priorEmbeddings.length > 0
    ? priorEmbeddings[priorEmbeddings.length - 1]
    : null;
  const adjacentRepetition = lastPrior
    ? cosineSimilarity(currentEmbedding, lastPrior)
    : 0;

  return {
    taskAlignment,
    noveltyScore,
    adjacentRepetition,
    available: true,
  };
}

/** Incrementally update centroid with a new embedding. */
export function updateCentroid(
  oldCentroid: readonly number[] | null,
  newEmbedding: readonly number[],
  count: number,
): number[] {
  if (!oldCentroid || count === 0) return [...newEmbedding];
  return oldCentroid.map((v, i) => (v * count + newEmbedding[i]!) / (count + 1));
}
