import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { loadObservations } from "./observations-store.js";
import { mergeObservationsIntoPrior } from "./observations-merge.js";

export interface ResolveOptions {
  /** Optional community profile (subset of ModelCalibration). Applied before local observations. */
  readonly communityProfile?: Partial<ModelCalibration>;
  /** Override base dir for observations (test hook). */
  readonly observationsBaseDir?: string;
}

/**
 * Three-tier calibration resolution:
 *   1. Shipped prior (input)
 *   2. Community prior (overrides fields the community profile declares)
 *   3. Local posterior (overrides once sample threshold is met)
 *
 * Returns the input prior by identity when no overrides apply.
 */
export function resolveCalibration(
  prior: ModelCalibration,
  opts: ResolveOptions = {},
): ModelCalibration {
  let current: ModelCalibration = prior;

  // Tier 2: community profile
  if (opts.communityProfile) {
    current = { ...current, ...opts.communityProfile };
  }

  // Tier 3: local observations
  const observations = loadObservations(prior.modelId, { baseDir: opts.observationsBaseDir });
  current = mergeObservationsIntoPrior(current, observations);

  // Return prior by identity when nothing changed
  return current === prior ? prior : current;
}
