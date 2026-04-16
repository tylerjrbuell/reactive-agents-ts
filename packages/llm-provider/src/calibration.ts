/**
 * ModelCalibration — per-model behavior measurements that drive harness adaptation.
 *
 * Calibration data answers questions that cannot be derived from model card, tier,
 * or general LLM knowledge. Each field has a downstream consumer in the harness:
 *
 * - steeringCompliance → ContextManager.build() guidance delivery channel
 * - parallelCallCapability → tool gating maxBatch + RULES parallel hint
 * - observationHandling → observation pipeline (inline-facts vs compress+recall)
 * - systemPromptAttention → rule repetition strategy on later turns
 * - optimalToolResultChars → ContextProfile.toolResultMaxChars
 */
import { Schema } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProviderAdapter } from "./adapter.js";
import { resolveCalibration, fetchCommunityProfile } from "@reactive-agents/reactive-intelligence";

/**
 * Structural shape for ContextProfile fields that calibration may override.
 * Kept minimal here to avoid a runtime dependency on @reactive-agents/reasoning.
 * Downstream callers spread this into their full ContextProfile.
 */
export interface ProfileOverrides {
  toolResultMaxChars?: number;
  toolResultPreviewItems?: number;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
}

// ── Schema ────────────────────────────────────────────────────────────────────

export const ModelCalibrationSchema = Schema.Struct({
  /** The model identifier (e.g., "gemma4:e4b", "llama3.2:3b") */
  modelId: Schema.String,

  /** ISO timestamp of calibration run */
  calibratedAt: Schema.String,

  /** Probe suite version — old calibrations degrade gracefully when this increments */
  probeVersion: Schema.Number,

  /** Number of probe runs averaged for stability */
  runsAveraged: Schema.Number,

  /** Does this model follow steering better in system prompt, user message, or both? */
  steeringCompliance: Schema.Literal("system-prompt", "user-message", "hybrid"),

  /** Can this model reliably batch independent tool calls in one turn? */
  parallelCallCapability: Schema.Literal("reliable", "partial", "sequential-only"),

  /** Given compressed preview + recall hint, does it call recall or hallucinate? */
  observationHandling: Schema.Literal("uses-recall", "needs-inline-facts", "hallucinate-risk"),

  /** After 4+ turns, does the model still follow system prompt rules? */
  systemPromptAttention: Schema.Literal("strong", "moderate", "weak"),

  /** Optimal chars per tool result before hallucination starts */
  optimalToolResultChars: Schema.Number,

  /** Derived from observed classifier false-positive rate. "low" → skip the classifier LLM call. */
  classifierReliability: Schema.optionalWith(
    Schema.Literal("high", "low", "skip"),
    { exact: true },
  ),
});

export type ModelCalibration = typeof ModelCalibrationSchema.Type;

// ── Loader ────────────────────────────────────────────────────────────────────

const calibrationCache = new Map<string, ModelCalibration | null>();

/**
 * Normalize a model ID for filename matching.
 * Examples: "gemma4:e4b" → "gemma4-e4b", "Llama3.2:3B" → "llama3.2-3b"
 */
export function normalizeModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");
}

/**
 * Load a pre-baked or cached calibration for the given modelId.
 * Returns undefined if no calibration exists.
 *
 * Lookup order:
 *   1. In-memory cache (per process)
 *   2. Pre-baked JSON in packages/llm-provider/src/calibrations/<normalized-id>.json
 *   3. User cache at ~/.reactive-agents/calibrations/<normalized-id>.json
 */
export function loadCalibration(modelId: string): ModelCalibration | undefined {
  const key = normalizeModelId(modelId);
  if (calibrationCache.has(key)) return calibrationCache.get(key) ?? undefined;

  // Try pre-baked calibrations shipped with framework.
  // When running from source, import.meta.url resolves to src/calibration.ts → src/calibrations/<key>.json.
  // When running from dist, it resolves to dist/index.js → dist/calibrations/ (populated by build) or
  // ../src/calibrations/ as a fallback (for test/dev scenarios where dist was produced without copying).
  const moduleDir = path.dirname(new URL(import.meta.url).pathname);
  const prebakedPath = path.join(moduleDir, "calibrations", `${key}.json`);
  const distFallbackPath = path.join(moduleDir, "..", "src", "calibrations", `${key}.json`);

  // Try user cache
  const userHome = process.env.HOME ?? "~";
  const userPath = path.join(userHome, ".reactive-agents", "calibrations", `${key}.json`);

  for (const candidatePath of [prebakedPath, distFallbackPath, userPath]) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const data = JSON.parse(fs.readFileSync(candidatePath, "utf-8"));
      const cal = Schema.decodeUnknownSync(ModelCalibrationSchema)(data);
      calibrationCache.set(key, cal);
      return cal;
    } catch {
      // Ignore parse errors, try next path
    }
  }

  calibrationCache.set(key, null);
  return undefined;
}

/**
 * Clear the in-memory calibration cache. Primarily for testing.
 */
export function clearCalibrationCache(): void {
  calibrationCache.clear();
}

// ── Compile calibration to adapter + profile overrides ───────────────────────

/**
 * Compile a ModelCalibration into a runtime ProviderAdapter + ProfileOverrides.
 *
 * The returned adapter overrides default tier behavior with measured behavior:
 *   - systemPromptAttention "weak"        → adds emphasis suffix to system prompt
 *   - parallelCallCapability "sequential-only" → nudges model to call tools one at a time
 *   - parallelCallCapability "partial"    → nudges model to cap batches at 2
 *   - parallelCallCapability "reliable"   → no toolGuidance override (default batching)
 *   - systemPromptAttention "strong"      → no systemPromptPatch override
 *
 * profileOverrides apply to the runtime ContextProfile (tool result sizing, etc.).
 *
 * Note: steeringCompliance and observationHandling are read directly by
 * ContextManager.build() and the observation pipeline — they do not surface
 * as adapter hooks here.
 */
export function buildCalibratedAdapter(
  calibration: ModelCalibration,
): { adapter: ProviderAdapter; profileOverrides: ProfileOverrides } {
  const adapter: ProviderAdapter = {
    systemPromptPatch: calibration.systemPromptAttention === "weak"
      ? (base: string, _tier: string) =>
          `${base}\n\nIMPORTANT: Follow ALL rules above exactly. Re-read them on each turn.`
      : undefined,

    toolGuidance: calibration.parallelCallCapability === "sequential-only"
      ? () =>
          "Call tools one at a time. Do not batch multiple tool calls in a single turn."
      : calibration.parallelCallCapability === "partial"
        ? () =>
            "You may call up to 2 independent tools at once. Avoid larger batches."
        : undefined,
  };

  const profileOverrides: ProfileOverrides = {
    toolResultMaxChars: calibration.optimalToolResultChars,
  };

  return { adapter, profileOverrides };
}

// ── Resolver ──────────────────────────────────────────────────────────────────

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
 * Uses fetchCommunityProfile from @reactive-agents/reactive-intelligence (already
 * statically imported). Community fetch failure is non-fatal — falls back to the
 * shipped prior + local observations tier.
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
