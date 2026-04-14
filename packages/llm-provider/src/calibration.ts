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

  // Try pre-baked calibrations shipped with framework
  const prebakedPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "calibrations",
    `${key}.json`,
  );

  // Try user cache
  const userHome = process.env.HOME ?? "~";
  const userPath = path.join(userHome, ".reactive-agents", "calibrations", `${key}.json`);

  for (const candidatePath of [prebakedPath, userPath]) {
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
