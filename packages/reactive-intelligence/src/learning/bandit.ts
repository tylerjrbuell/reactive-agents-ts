import type { BanditStore } from "./bandit-store.js";

/**
 * Sample from Beta(alpha, beta) distribution.
 * Uses Gamma samples: X = Ga/(Ga+Gb) where Ga ~ Gamma(a,1), Gb ~ Gamma(b,1).
 */
function sampleBeta(alpha: number, beta: number): number {
  const ga = sampleGamma(alpha);
  const gb = sampleGamma(beta);
  return ga / (ga + gb);
}

/**
 * Sample from Gamma(shape, 1) using Marsaglia and Tsang's method.
 */
function sampleGamma(shape: number): number {
  if (shape < 1) return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = normalRandom();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Box-Muller transform for standard normal samples. */
function normalRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Select an arm using Thompson Sampling.
 * Cold start: if all arms have fewer than 5 pulls, return uniform random.
 */
export function selectArm(
  contextBucket: string,
  armIds: readonly string[],
  store: BanditStore,
): string {
  const arms = armIds.map((id) =>
    store.load(contextBucket, id) ?? { contextBucket, armId: id, alpha: 1, beta: 1, pulls: 0 },
  );

  // Cold start: uniform random if all arms under-explored
  const COLD_START_THRESHOLD = 5;
  if (arms.every((a) => a.pulls < COLD_START_THRESHOLD)) {
    return armIds[Math.floor(Math.random() * armIds.length)]!;
  }

  // Thompson Sampling: sample from each arm's posterior, pick highest
  let bestArm = armIds[0]!;
  let bestSample = -Infinity;
  for (const arm of arms) {
    const sample = sampleBeta(arm.alpha, arm.beta);
    if (sample > bestSample) {
      bestSample = sample;
      bestArm = arm.armId;
    }
  }
  return bestArm;
}

/**
 * Update arm stats after observing a reward.
 * reward > 0.5 increments alpha (success), else increments beta (failure).
 */
export function updateArm(
  contextBucket: string,
  armId: string,
  reward: number,
  store: BanditStore,
): void {
  const existing = store.load(contextBucket, armId) ?? {
    contextBucket,
    armId,
    alpha: 1,
    beta: 1,
    pulls: 0,
  };
  const updated = reward > 0.5
    ? { ...existing, alpha: existing.alpha + 1, pulls: existing.pulls + 1 }
    : { ...existing, beta: existing.beta + 1, pulls: existing.pulls + 1 };
  store.save(updated);
}
