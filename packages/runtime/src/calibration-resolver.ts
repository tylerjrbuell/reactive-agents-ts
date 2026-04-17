import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { loadCalibration } from "@reactive-agents/llm-provider";
import { resolveCalibration, fetchCommunityProfile } from "@reactive-agents/reactive-intelligence";

export interface ResolveModelCalibrationOptions {
  readonly communityProfile?: Partial<ModelCalibration>;
  readonly observationsBaseDir?: string;
}

export interface ResolveModelCalibrationAsyncOptions extends ResolveModelCalibrationOptions {
  /** When true, fetch a community profile from the telemetry API. */
  readonly fetchCommunity?: boolean;
  /** Override community endpoint URL (for tests). */
  readonly communityEndpoint?: string;
  /** Override fetch implementation (for tests). */
  readonly communityFetchImpl?: typeof fetch;
  /** Override community cache dir (for tests). */
  readonly communityCacheDir?: string;
}

/**
 * Load the shipped prior for the given model and merge it with the community
 * profile (when supplied) and local observations. Returns undefined when no
 * prior is found AND no override data is available.
 */
export function resolveModelCalibration(
  modelId: string,
  opts: ResolveModelCalibrationOptions = {},
): ModelCalibration | undefined {
  const prior = loadCalibration(modelId);
  if (!prior && !opts.communityProfile) return undefined;

  const base: ModelCalibration = prior ?? {
    modelId,
    calibratedAt: new Date().toISOString(),
    probeVersion: 0,
    runsAveraged: 0,
    steeringCompliance: "hybrid",
    parallelCallCapability: "partial",
    observationHandling: "needs-inline-facts",
    systemPromptAttention: "moderate",
    optimalToolResultChars: 1200,
  };

  return resolveCalibration(base, {
    communityProfile: opts.communityProfile,
    observationsBaseDir: opts.observationsBaseDir,
  });
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
  return resolveModelCalibration(modelId, { ...opts, communityProfile: community });
}
