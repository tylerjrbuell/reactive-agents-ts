// File: src/context/profile-resolver.ts
import type { ContextProfile, ModelTier } from "./context-profile.js";
import { CONTEXT_PROFILES, mergeProfile } from "./context-profile.js";

// ─── Model Name → Tier Heuristics ───

const LOCAL_PATTERNS = [
  "ollama:",
  "llama",
  "mistral",
  "phi-",
  "phi3",
  "phi4",
  "qwen",
  "deepseek",
  "codellama",
  "cogito",
  "gemma",
  "tinyllama",
];

const MID_PATTERNS = [
  "haiku",
  "mini",
  "flash",
  "gpt-4o-mini",
  "gemini-2.0-flash",
];

const LARGE_PATTERNS = [
  "sonnet",
  "gpt-4o",
  "gpt-4-turbo",
  "gemini-2.5-pro",
  "gemini-pro",
];

const FRONTIER_PATTERNS = [
  "opus",
  "claude-opus",
  "o1",
  "o3",
  "gpt-5",
];

function tierFromModelName(model: string): ModelTier {
  const lower = model.toLowerCase();

  // Check exact/compound patterns first to avoid substring collisions
  // e.g., "gpt-4o-mini" must match "mid" (gpt-4o-mini) before "large" (gpt-4o)
  // e.g., "phi-3-mini" must match "local" (phi-) before "mid" (mini)

  // Frontier: check first since these are the most specific
  if (FRONTIER_PATTERNS.some((p) => lower.includes(p))) return "frontier";

  // Local: check before mid/large since local models often contain
  // substrings that overlap mid patterns (e.g., phi-3-mini has "mini")
  if (LOCAL_PATTERNS.some((p) => lower.includes(p))) return "local";

  // Mid: compound name patterns checked first
  if (lower.includes("gpt-4o-mini")) return "mid";
  if (MID_PATTERNS.some((p) => lower.includes(p))) return "mid";

  // Large
  if (LARGE_PATTERNS.some((p) => lower.includes(p))) return "large";

  return "mid";
}

function tierFromQuality(quality: number): ModelTier {
  if (quality >= 0.9) return "frontier";
  if (quality >= 0.75) return "large";
  if (quality >= 0.6) return "mid";
  return "local";
}

/**
 * Resolve a ContextProfile from either a model name, a quality score, or a tier.
 * Accepts optional overrides to customize specific fields.
 */
export function resolveProfile(
  modelOrQuality: string | number | ModelTier,
  customOverrides?: Partial<ContextProfile>,
): ContextProfile {
  let tier: ModelTier;

  if (typeof modelOrQuality === "number") {
    tier = tierFromQuality(modelOrQuality);
  } else if (
    modelOrQuality === "local" ||
    modelOrQuality === "mid" ||
    modelOrQuality === "large" ||
    modelOrQuality === "frontier"
  ) {
    tier = modelOrQuality;
  } else {
    tier = tierFromModelName(modelOrQuality);
  }

  const base = CONTEXT_PROFILES[tier];
  return customOverrides ? mergeProfile(base, customOverrides) : base;
}
