import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { loadCalibration } from "@reactive-agents/llm-provider";
import {
  emptyObservations,
  fetchCommunityProfile,
  loadObservations,
  mergeObservationsIntoPrior,
  OVERRIDE_THRESHOLD,
} from "@reactive-agents/reactive-intelligence";

export interface ResolveModelCalibrationOptions {
  readonly communityProfile?: Partial<ModelCalibration>;
  readonly observationsBaseDir?: string;
  /**
   * Apply local run observations (tier 3). Default `true` for this direct
   * call; `false` resolves shipped + community only. An agent run passes
   * `false` unless `.withCalibration("auto", { learned: true })` opted in.
   */
  readonly localObservations?: boolean;
}

/**
 * The opt-in calibration tier flags as they travel in a run's
 * `reactiveIntelligenceOptions` to the engine's calibration setup
 * (`engine/phases/agent-loop/setup/calibration.ts`). Set by
 * `.withCalibration("auto", { learned, community })`. Absent or `false` = off.
 * A type alias (not an interface) so it stays assignable to the
 * `Record<string, unknown>` options channel.
 */
export type CalibrationTierFlags = {
  /** Apply local run observations (the learned tier). */
  readonly learnedCalibration?: boolean;
  /** Fetch the community profile (the community tier). */
  readonly communityCalibration?: boolean;
};

export interface ResolveModelCalibrationAsyncOptions extends ResolveModelCalibrationOptions {
  /** When true, fetch a community profile from the telemetry API. */
  readonly fetchCommunity?: boolean;
  /** Override community endpoint URL (for tests). */
  readonly communityEndpoint?: string;
  /** Override fetch implementation (for tests). */
  readonly communityFetchImpl?: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
  /** Override community cache dir (for tests). */
  readonly communityCacheDir?: string;
}

/**
 * Where a resolved calibration field's value came from:
 * - `shipped` — the calibration file shipped with the framework for this model;
 * - `community` — the community profile (declared the field);
 * - `learned` — this machine's local run observations changed the value;
 * - `default` — the framework default, used when the model has no shipped calibration.
 */
export type CalibrationSource = "shipped" | "community" | "learned" | "default";

/** Per-field source of a resolved calibration. Keys absent from the calibration are absent here. */
export type CalibrationProvenance = Readonly<Partial<Record<keyof ModelCalibration, CalibrationSource>>>;

/** A resolved calibration plus the source of each of its fields. */
export interface ResolvedModelCalibration {
  readonly calibration: ModelCalibration;
  readonly provenance: CalibrationProvenance;
}

/** Framework defaults for a model with no shipped calibration. */
const defaultCalibration = (modelId: string): ModelCalibration => ({
  modelId,
  calibratedAt: new Date().toISOString(),
  probeVersion: 0,
  runsAveraged: 0,
  steeringCompliance: "hybrid",
  parallelCallCapability: "partial",
  observationHandling: "needs-inline-facts",
  systemPromptAttention: "moderate",
  optimalToolResultChars: 1200,
  toolCallDialect: "none",
});

const fieldsOf = (c: Partial<ModelCalibration>): (keyof ModelCalibration)[] =>
  (Object.keys(c) as (keyof ModelCalibration)[]).filter((k) => c[k] !== undefined);

/**
 * Resolve a model's calibration in three tiers and report where each field came from:
 *   1. the shipped calibration (or the framework defaults when none ships),
 *   2. the community profile (overrides the fields it declares),
 *   3. local observations (override once {@link OVERRIDE_THRESHOLD} runs are recorded).
 *
 * A model with no shipped calibration and no community profile resolves only
 * when local observations reach the threshold: defaults plus the learned fields.
 * Otherwise it returns `undefined`.
 *
 * A learned value equal to the earlier tier's value keeps the earlier tier's label.
 *
 * @param modelId - The model id to resolve.
 * @param opts - Community profile and observations dir override.
 * @returns The calibration and its per-field provenance, or `undefined`.
 *
 * @example
 * ```typescript
 * const res = resolveModelCalibrationWithProvenance("qwen3:4b");
 * res?.provenance.parallelCallCapability; // "shipped" | "community" | "learned" | "default"
 * ```
 */
export function resolveModelCalibrationWithProvenance(
  modelId: string,
  opts: ResolveModelCalibrationOptions = {},
): ResolvedModelCalibration | undefined {
  const prior = loadCalibration(modelId);
  const base = prior ?? defaultCalibration(modelId);
  // Observations key on the calibration's own model id (as the RI resolver does).
  const observations =
    opts.localObservations === false
      ? emptyObservations(base.modelId)
      : loadObservations(base.modelId, { baseDir: opts.observationsBaseDir });
  const learnedEnough = observations.runs.length >= OVERRIDE_THRESHOLD;
  if (!prior && !opts.communityProfile && !learnedEnough) return undefined;

  const provenance: Partial<Record<keyof ModelCalibration, CalibrationSource>> = {};
  const baseSource: CalibrationSource = prior ? "shipped" : "default";
  for (const k of fieldsOf(base)) provenance[k] = baseSource;

  let current: ModelCalibration = base;
  if (opts.communityProfile) {
    current = { ...current, ...opts.communityProfile };
    for (const k of fieldsOf(opts.communityProfile)) provenance[k] = "community";
  }

  const learned = mergeObservationsIntoPrior(current, observations);
  for (const k of fieldsOf(learned)) {
    if (learned[k] !== current[k]) provenance[k] = "learned";
  }
  return { calibration: learned, provenance };
}

/**
 * Load the shipped prior for the given model and merge it with the community
 * profile (when supplied) and local observations. A model with no shipped
 * prior resolves to the framework defaults plus what local observations
 * learned, once enough runs are recorded. Returns undefined when no prior is
 * found AND no override data is available.
 *
 * Use {@link resolveModelCalibrationWithProvenance} to also see where each
 * field came from.
 */
export function resolveModelCalibration(
  modelId: string,
  opts: ResolveModelCalibrationOptions = {},
): ModelCalibration | undefined {
  return resolveModelCalibrationWithProvenance(modelId, opts)?.calibration;
}

/**
 * Async variant of resolveModelCalibration that can fetch the community profile.
 * When fetchCommunity is false or the fetch fails, falls back to the sync path.
 *
 * Community fetch failure is non-fatal — falls back to the shipped prior +
 * local observations tier.
 */
export async function resolveModelCalibrationAsync(
  modelId: string,
  opts: ResolveModelCalibrationAsyncOptions = {},
): Promise<ModelCalibration | undefined> {
  return (await resolveModelCalibrationWithProvenanceAsync(modelId, opts))?.calibration;
}

/**
 * Async variant of {@link resolveModelCalibrationWithProvenance}: fetches the
 * community profile when asked (failure is non-fatal) and reports where each
 * resolved field came from.
 */
export async function resolveModelCalibrationWithProvenanceAsync(
  modelId: string,
  opts: ResolveModelCalibrationAsyncOptions = {},
): Promise<ResolvedModelCalibration | undefined> {
  let community = opts.communityProfile;
  if (!community && opts.fetchCommunity) {
    try {
      community = await fetchCommunityProfile(modelId, {
        endpoint: opts.communityEndpoint,
        cacheDir: opts.communityCacheDir,
        fetchImpl: opts.communityFetchImpl,
      }) ?? undefined;
    } catch {
      // Community fetch failure is non-fatal — fall through to sync path
    }
  }
  return resolveModelCalibrationWithProvenance(modelId, { ...opts, communityProfile: community });
}
