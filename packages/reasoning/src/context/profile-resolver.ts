// File: src/context/profile-resolver.ts
import type { ContextProfile, ModelTier } from "./context-profile.js";
import { CONTEXT_PROFILES, mergeProfile } from "./context-profile.js";

// ─── Model Name → Tier Heuristics ───

// Truly small models that should always be "local" tier
const LOCAL_PATTERNS = ["tinyllama", "phi-2", "gemma-2b", "stablelm"];

// Local models >=7B that deserve "mid" tier prompts and budgets
const CAPABLE_LOCAL_PATTERNS = [
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

// ─── Provider-Scoped Tier Patterns ───────────────────────────────────────────

/**
 * Provider-aware tier patterns. When a provider is known, these are checked
 * before the global fallback patterns to prevent cross-provider substring collisions.
 *
 * Example: "flash" is a valid mid-tier word globally, but "gemini-2.5-flash" should
 * be "large" because within the gemini namespace "2.5" always means the newer capable
 * generation that outperforms the older "2.0" flash. Provider context makes this
 * unambiguous without requiring a hardcoded model lookup table.
 *
 * Tiers within each provider are checked in the order defined by
 * PROVIDER_TIER_CHECK_ORDER (frontier → mid → large → local).
 * "mid" before "large" prevents compound-name substring collisions
 * (e.g., "gpt-4o-mini" must not match "gpt-4o" in the large bucket first).
 */
const PROVIDER_TIER_PATTERNS: Partial<Record<string, Partial<Record<ModelTier, readonly string[]>>>> = {
  gemini: {
    /** 2.5-pro and experimental ultra-class models — Google's top tier */
    frontier: ["gemini-2.5-pro", "gemini-ultra", "gemini-exp"],
    /** 2.5-flash and 1.5-pro: capable but not the top-tier frontier variant */
    large:    ["gemini-2.5", "gemini-1.5-pro"],
    /** 2.0-flash, 1.5-flash, and nano-class: mid-range flash/lite variants */
    mid:      ["gemini-2.0", "gemini-1.5-flash", "gemini-flash", "gemini-nano"],
  },
  anthropic: {
    frontier: ["opus"],
    large:    ["sonnet"],
    mid:      ["haiku"],
  },
  openai: {
    frontier: ["o1", "o3", "o4", "gpt-5"],
    /** gpt-4o-mini listed before gpt-4o to prevent "gpt-4o" matching "gpt-4o-mini" */
    mid:      ["gpt-4o-mini", "gpt-3.5", "gpt-4-mini"],
    large:    ["gpt-4o", "gpt-4-turbo", "gpt-4"],
  },
};

/** Tier evaluation order for provider-scoped lookup. mid before large prevents compound-name collisions. */
const PROVIDER_TIER_CHECK_ORDER: readonly ModelTier[] = ["frontier", "mid", "large", "local"];

function tierFromModelName(model: string, provider?: string): ModelTier {
  const lower = model.toLowerCase();

  // Ollama models are always local/mid — never match cloud model pattern terms like "flash" or "mini".
  // Use size hints only; skip all global pattern matching.
  if (provider === "ollama" || lower.startsWith("ollama:")) {
    if (LOCAL_PATTERNS.some((p) => lower.includes(p))) return "local";
    const sizeMatch = lower.match(/(\d+)b/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1], 10);
      if (size <= 3) return "local";
    }
    return "mid";
  }

  // Provider-scoped patterns: more precise than global patterns.
  // Prevents cross-provider substring collisions (e.g., "flash" on gemini vs. other providers).
  if (provider) {
    const providerPatterns = PROVIDER_TIER_PATTERNS[provider];
    if (providerPatterns) {
      for (const tier of PROVIDER_TIER_CHECK_ORDER) {
        const patterns = providerPatterns[tier];
        if (patterns?.some((p) => lower.includes(p))) return tier;
      }
    }
  }

  // Global pattern fallback (provider unknown or unrecognized).
  // Check exact/compound patterns first to avoid substring collisions
  // e.g., "gpt-4o-mini" must match "mid" before "large" (gpt-4o)
  // e.g., "phi-3-mini" must match "local" (phi-) before "mid" (mini)

  // Frontier: check first since these are the most specific
  if (FRONTIER_PATTERNS.some((p) => lower.includes(p))) return "frontier";

  // Truly small models → always local
  if (LOCAL_PATTERNS.some((p) => lower.includes(p))) return "local";

  // Capable local models (>=7B) → mid by default, with size hinting
  if (CAPABLE_LOCAL_PATTERNS.some((p) => lower.includes(p))) {
    const sizeMatch = lower.match(/(\d+)b/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1], 10);
      if (size <= 3) return "local";
      if (size >= 13) return "mid";
    }
    return "mid";
  }

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
 *
 * @param modelOrQuality - Model name string, quality score (0–1), or explicit tier.
 * @param customOverrides - Partial profile overrides applied on top of the resolved tier defaults.
 * @param provider - LLM provider name (e.g., "gemini", "anthropic", "openai", "ollama").
 *                   When provided, enables provider-scoped pattern matching for more accurate
 *                   tier classification, preventing cross-provider substring collisions.
 *                   Example: "gemini-2.5-flash" → "mid" without provider context, but correctly
 *                   resolves to "large" when provider="gemini" because the "2.5" generation
 *                   prefix is checked before the generic "flash" pattern fires.
 */
export function resolveProfile(
  modelOrQuality: string | number | ModelTier,
  customOverrides?: Partial<ContextProfile>,
  provider?: string,
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
    tier = tierFromModelName(modelOrQuality, provider);
  }

  const base = CONTEXT_PROFILES[tier];
  return customOverrides ? mergeProfile(base, customOverrides) : base;
}
