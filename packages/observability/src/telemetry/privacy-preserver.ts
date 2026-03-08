/**
 * Privacy Preserver — Differential privacy via Laplacian noise + field stripping.
 *
 * Implements the privacy guarantees for opt-in telemetry:
 * - Laplacian noise (epsilon=0.1) on all numerical fields
 * - Strips: raw prompts, API keys, PII, task descriptions, custom tool names
 * - Keeps: strategy name, model tier, token counts (noised), latency (noised), success/fail, safe tool names
 * - Timestamps bucketed to the hour
 *
 * @see telemetry-schema.ts for the record format
 */
import type { TelemetryRecord, ModelTier } from "./telemetry-schema.js";
import { SAFE_TOOL_NAMES } from "./telemetry-schema.js";

// ─── Configuration ───

/** Privacy configuration for telemetry. */
export interface PrivacyConfig {
  /** Epsilon parameter for Laplacian noise. Lower = more private. @default 0.1 */
  readonly epsilon?: number;
  /** Sensitivity (maximum influence of a single record). @default 1.0 */
  readonly sensitivity?: number;
  /** Minimum value clamp for noised numbers (prevents negative tokens/cost). @default 0 */
  readonly minClamp?: number;
}

const DEFAULT_EPSILON = 0.1;
const DEFAULT_SENSITIVITY = 1.0;

// ─── Laplacian Noise ───

/**
 * Sample from Laplace(0, b) where b = sensitivity / epsilon.
 *
 * Uses the inverse CDF method: if U ~ Uniform(0,1), then
 * X = -b * sign(U - 0.5) * ln(1 - 2|U - 0.5|)
 */
function laplacianNoise(epsilon: number, sensitivity: number): number {
  const b = sensitivity / epsilon;
  const u = Math.random() - 0.5;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/**
 * Add Laplacian noise to a number and clamp to a minimum.
 */
function noiseAndClamp(value: number, epsilon: number, sensitivity: number, min: number): number {
  return Math.max(min, value + laplacianNoise(epsilon, sensitivity));
}

// ─── Model Tier Classification ───

/** Map a model name to a coarse tier — never leak exact model name. */
export function classifyModelTier(model: string): ModelTier {
  const lower = model.toLowerCase();

  // Local/self-hosted
  if (lower.includes("ollama") || lower.includes("llama") || lower.includes("mistral") || lower.includes("phi")) {
    return "local";
  }
  // Frontier — check before small so "o3-mini" → frontier (not small)
  if (lower.includes("opus") || /\bo1\b/.test(lower) || /\bo3\b/.test(lower)) {
    return "frontier";
  }
  // Small — "-mini" suffix overrides larger model families (e.g., "gpt-4o-mini")
  // Use "-mini" or end-of-string boundary to avoid matching "gemini"
  if (/-mini\b/.test(lower) || lower.includes("nano") || lower.includes("tiny")) {
    return "small";
  }
  // Large
  if (lower.includes("sonnet") || lower.includes("gpt-4") || lower.includes("gemini-pro") || lower.includes("claude-3.5")) {
    return "large";
  }
  // Medium
  if (lower.includes("haiku") || lower.includes("gpt-3.5") || lower.includes("gemini-flash") || lower.includes("claude-3")) {
    return "medium";
  }

  return "medium"; // conservative default
}

// ─── Timestamp Bucketing ───

/** Bucket a Date to the nearest hour (ISO string with minutes/seconds zeroed). */
export function bucketToHour(date: Date): string {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

// ─── Tool Name Sanitization ───

/** Filter tool names to only include safe built-in names. Custom tools become "custom". */
export function sanitizeToolNames(toolNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of toolNames) {
    const safe = SAFE_TOOL_NAMES.has(name) ? name : "custom";
    if (!seen.has(safe)) {
      seen.add(safe);
      result.push(safe);
    }
  }

  return result;
}

// ─── Privacy Preserver ───

/**
 * Raw run data before privacy processing.
 *
 * This is what the local aggregator collects from EventBus events.
 * It may contain exact model names, custom tool names, etc.
 */
export interface RawRunData {
  readonly strategy: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyMs: number;
  readonly success: boolean;
  readonly toolNames: readonly string[];
  readonly iterationCount: number;
  readonly costUsd: number;
  readonly cacheHitRate: number;
  readonly timestamp: Date;
}

/**
 * Apply differential privacy to raw run data, producing an anonymized TelemetryRecord.
 *
 * - Generates a fresh random runId (not correlated to any real ID)
 * - Adds Laplacian noise to all numerical fields
 * - Classifies model to coarse tier
 * - Strips custom tool names
 * - Buckets timestamp to the hour
 */
export function preservePrivacy(
  raw: RawRunData,
  config: PrivacyConfig = {},
): TelemetryRecord {
  const epsilon = config.epsilon ?? DEFAULT_EPSILON;
  const sensitivity = config.sensitivity ?? DEFAULT_SENSITIVITY;
  const minClamp = config.minClamp ?? 0;

  return {
    runId: crypto.randomUUID(),
    strategy: raw.strategy,
    modelTier: classifyModelTier(raw.model),
    tokensIn: Math.round(noiseAndClamp(raw.tokensIn, epsilon, sensitivity * 100, minClamp)),
    tokensOut: Math.round(noiseAndClamp(raw.tokensOut, epsilon, sensitivity * 100, minClamp)),
    latencyMs: Math.round(noiseAndClamp(raw.latencyMs, epsilon, sensitivity * 1000, minClamp)),
    success: raw.success,
    toolNames: sanitizeToolNames(raw.toolNames),
    iterationCount: Math.max(1, Math.round(noiseAndClamp(raw.iterationCount, epsilon, sensitivity * 5, 1))),
    costUsd: Math.max(0, noiseAndClamp(raw.costUsd, epsilon, sensitivity * 0.01, 0)),
    cacheHitRate: Math.max(0, Math.min(1, noiseAndClamp(raw.cacheHitRate, epsilon, sensitivity * 0.1, 0))),
    timestampBucket: bucketToHour(raw.timestamp),
  };
}
