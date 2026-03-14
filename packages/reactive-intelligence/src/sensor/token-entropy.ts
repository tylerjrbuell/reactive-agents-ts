import type { TokenLogprob, TokenEntropy } from "../types.js";

/**
 * Compute per-token normalized Shannon entropy from logprob distributions.
 * TECP-inspired: H_norm(t_i) = H(t_i) / log2(k) ∈ [0, 1]
 *
 * Returns null if logprobs are unavailable.
 */
export function computeTokenEntropy(
  logprobs: readonly TokenLogprob[] | undefined,
  spikeThreshold = 0.7,
): TokenEntropy | null {
  if (!logprobs || logprobs.length === 0) return null;

  const tokenEntropies: number[] = [];

  for (const lp of logprobs) {
    const tops = lp.topLogprobs;
    if (!tops || tops.length === 0) {
      // No distribution → assume zero entropy (greedy pick)
      tokenEntropies.push(0);
      continue;
    }

    // Convert logprobs to probabilities
    const probs = tops.map((t) => Math.exp(t.logprob));
    const sum = probs.reduce((a, b) => a + b, 0);

    // Normalize
    const normalized = probs.map((p) => p / sum);

    // Shannon entropy: H = -Σ p_i × log2(p_i)
    let h = 0;
    for (const p of normalized) {
      if (p > 0) h -= p * Math.log2(p);
    }

    // Normalize by max entropy: log2(k)
    const maxEntropy = Math.log2(tops.length);
    const hNorm = maxEntropy > 0 ? h / maxEntropy : 0;

    tokenEntropies.push(Math.max(0, Math.min(1, hNorm)));
  }

  const sequenceEntropy =
    tokenEntropies.length > 0
      ? tokenEntropies.reduce((a, b) => a + b, 0) / tokenEntropies.length
      : 0;

  const peakEntropy = Math.max(0, ...tokenEntropies);

  const entropySpikes = tokenEntropies
    .map((value, position) => ({ position, value }))
    .filter((s) => s.value > spikeThreshold);

  // toolCallEntropy: mean entropy over JSON-like regions (heuristic: tokens containing {, }, [, ])
  // For now, use sequenceEntropy as fallback — refined in integration
  const toolCallEntropy = sequenceEntropy;

  return {
    tokenEntropies,
    sequenceEntropy,
    toolCallEntropy,
    peakEntropy,
    entropySpikes,
  };
}
