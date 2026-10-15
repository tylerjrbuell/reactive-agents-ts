// File: src/context/profile-resolver.ts
import type { ContextProfile, ModelTier } from "./context-profile.js";
import { CONTEXT_PROFILES, mergeProfile, applyCapabilityMaxTokens } from "./context-profile.js";
import { resolveCapability } from "@reactive-agents/llm-provider";

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
  // W2b: the `/(\d+)b/` SIZE-REGEX branch is DELETED (plan 2.1, design law
  // #1 — one capability arbiter). It overrode the registry for every Ollama
  // model ("qwen3:1.7b" hit "7b"; "qwen3:4b" and every >=4B tag became mid
  // regardless of the Capability row saying local). This path now runs ONLY
  // on a registry miss (see `resolveProfileWithWindow`), where the truly-
  // small name list is the sole defensible signal left; anything else takes
  // the conservative mid default the old branch also fell through to.
  if (provider === "ollama" || lower.startsWith("ollama:")) {
    if (LOCAL_PATTERNS.some((p) => lower.includes(p))) return "local";
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

// ─── W2b Registry-First Tiering (plan 2.1, design law #1) ───────────────────

/**
 * Normalize a model string for the Capability registry key. The static
 * table is keyed `${provider}/${model}`, and model strings arrive in three
 * shapes: bare tag ("qwen3:4b" + provider="ollama"), LiteLLM slash form
 * ("ollama/qwen3:4b"), or the `ollama:` prefix form. Returns the
 * (providerKey, modelKey) pair, or null when no provider can be determined
 * — without a provider the registry is unconsultable and only the
 * provisional name-regex path remains.
 */
function registryLookupKey(
  model: string,
  provider?: string,
): { readonly providerKey: string; readonly modelKey: string } | null {
  const lower = model.toLowerCase();
  // Infer ollama from the prefix form when no provider was passed.
  const providerKey = provider ?? (lower.startsWith("ollama:") ? "ollama" : undefined);
  if (providerKey === undefined) return null;
  let modelKey = model;
  if (lower.startsWith(`${providerKey}/`)) {
    modelKey = model.slice(providerKey.length + 1);
  } else if (providerKey === "ollama" && lower.startsWith("ollama:")) {
    modelKey = model.slice("ollama:".length);
  }
  return { providerKey, modelKey };
}

/**
 * Tier from the Capability registry — the single arbiter (law #1). Consults
 * the synchronous three-tier `resolveCapability` lookup (explicit cache →
 * process-wide probed registry → static table → conservative fallback),
 * mirroring `applyCapabilityMaxTokens`, the existing sync capability read on
 * this same seam. Persisted probe rows reach the probed registry through
 * the builder's `primeCapability` step (store-first, endpoint-scoped —
 * see llm-provider/src/providers/local-probe.ts), which runs BEFORE this
 * resolution.
 *
 * A resolved Capability with `source: "fallback"` is a registry MISS: the
 * fallback row's tier is a window-safety default, not a verdict about the
 * model, so tiering must not trust it — the caller falls to the
 * provisional name-regex path.
 *
 * @returns The registry tier, or null on miss / unconsultable provider.
 */
export function tierFromRegistry(model: string, provider?: string): ModelTier | null {
  const key = registryLookupKey(model, provider);
  if (key === null) return null;
  // GH #239 (replaces the W2b provider-name carve-out): stub truth is
  // registry-owned. The `test/test` static row marks itself `nominal` —
  // its tier is a placeholder for the bench window contract, not a verdict
  // about a model — so ANY consumer consulting the registry read path gets
  // "do not arbitrate" for free, instead of duplicating a provider-string
  // special case per call site (which Wave 3b was about to become).
  const cap = resolveCapability(key.providerKey, key.modelKey);
  if (cap.nominal === true) return null;
  return cap.source === "fallback" ? null : cap.tier;
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

/**
 * Resolve a context profile AND bind its operational window to the model.
 *
 * `resolveProfile` picks the tier and returns `CONTEXT_PROFILES[tier]`, whose
 * `maxTokens` is a tier PLACEHOLDER (e.g. 32768 for mid), NOT a deliberate cap.
 * Downstream, `applyCapabilityMaxTokens` (the runner) treats any present
 * `maxTokens` as caller-authoritative and skips model resolution — so a profile
 * carrying the placeholder makes builder-constructed agents run at the tier
 * placeholder (mid haiku at 32768) instead of the model's real window (200k).
 * This binds the window to the model up-front (`recommendedNumCtx` per the
 * static capability table / fallback), making capability the single source of
 * truth and matching the createRuntime/runner path. Per-model resolution keeps
 * the intentional ollama-safe fallbacks (e.g. unknown ollama → 2048) intact.
 *
 * Used by the builder's auto-resolution (no explicit caller profile — the
 * builder only reaches this seam when one is unset, which is the "explicit
 * caller profile wins" tier of the W2b precedence). Pure / synchronous.
 *
 * W2b (plan 2.1) — precedence inside this seam: Capability registry tier
 * (static-table row OR probe row, incl. persisted rows re-injected by the
 * builder prime) consulted BEFORE any name regex; registry miss falls to the
 * provisional name-regex path and marks the returned profile
 * `provisionalTier: true`. Window binding is unchanged (already
 * registry-fed via `applyCapabilityMaxTokens`).
 */
export function resolveProfileWithWindow(
  model: string,
  provider?: string,
): ContextProfile {
  const registryTier = tierFromRegistry(model, provider);
  const base =
    registryTier !== null
      ? CONTEXT_PROFILES[registryTier]
      : // Registry miss — the name regex is a provisional guess; copy the
        // tier profile and mark it so downstream consumers (Wave 3 driver
        // routing) can tell an unverified tier from an arbiter verdict.
        // Registry-hit profiles keep CONTEXT_PROFILES identity (no spread).
        { ...resolveProfile(model, undefined, provider), provisionalTier: true };
  return applyCapabilityMaxTokens(base, provider, model, undefined);
}
