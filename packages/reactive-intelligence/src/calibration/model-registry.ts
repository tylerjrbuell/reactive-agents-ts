import type { ModelRegistryEntry } from "../types.js";

export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  // Ollama / local models
  "gemma4:e4b":    { contextLimit: 32_768, tier: "local", logprobSupport: false },
  "cogito:14b":    { contextLimit: 32_768, tier: "local", logprobSupport: true },
  "qwen3.5:14b":   { contextLimit: 32_768, tier: "local", logprobSupport: true },
  "qwen3:14b":     { contextLimit: 32_768, tier: "local", logprobSupport: true },
  "llama3.3:70b":  { contextLimit: 131_072, tier: "local", logprobSupport: true },

  // Anthropic (prefix match — versioned IDs like claude-sonnet-4-20250514)
  "claude-sonnet-4":  { contextLimit: 200_000, tier: "frontier", logprobSupport: false },
  "claude-opus-4":    { contextLimit: 200_000, tier: "frontier", logprobSupport: false },
  "claude-haiku-4":   { contextLimit: 200_000, tier: "frontier", logprobSupport: false },

  // OpenAI
  "gpt-4o":       { contextLimit: 128_000, tier: "frontier", logprobSupport: true },
  "gpt-4o-mini":  { contextLimit: 128_000, tier: "frontier", logprobSupport: true },
};

const DEFAULT_ENTRY: ModelRegistryEntry = {
  contextLimit: 32_768,
  tier: "unknown",
  logprobSupport: false,
};

/** Provider → tier mapping for models not in the registry. */
const PROVIDER_TIER: Record<string, ModelRegistryEntry["tier"]> = {
  ollama: "local",
  anthropic: "frontier",
  openai: "frontier",
  gemini: "frontier",
  // litellm proxies many providers — can't infer tier without model metadata.
  // Defer to "unknown" until the community profile API has enough data.
};

/**
 * Look up a model by ID. Resolution order:
 * 1. Exact match in built-in registry
 * 2. Prefix match in built-in registry (e.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4")
 * 3. Exact match in overrides
 * 4. Provider-derived tier (ollama → local, anthropic/openai/gemini → frontier)
 * 5. Safe defaults (tier: "unknown")
 */
export function lookupModel(
  id: string,
  overrides?: Record<string, ModelRegistryEntry>,
  providerName?: string,
): ModelRegistryEntry {
  // 1. Exact match
  if (MODEL_REGISTRY[id]) return MODEL_REGISTRY[id]!;

  // 2. Prefix match (bidirectional) — find longest matching key
  //    "claude-sonnet-4-20250514" matches key "claude-sonnet-4" (id starts with key)
  //    "cogito" matches key "cogito:14b" (key starts with id)
  let bestMatch: ModelRegistryEntry | undefined;
  let bestLen = 0;
  for (const key of Object.keys(MODEL_REGISTRY)) {
    if (id.startsWith(key) && key.length > bestLen) {
      bestMatch = MODEL_REGISTRY[key]!;
      bestLen = key.length;
    } else if (key.startsWith(id) && id.length > bestLen) {
      bestMatch = MODEL_REGISTRY[key]!;
      bestLen = id.length;
    }
  }
  if (bestMatch) return bestMatch;

  // 3. Overrides
  if (overrides?.[id]) return overrides[id]!;

  // 4. Provider-derived tier
  if (providerName) {
    const tier = PROVIDER_TIER[providerName.toLowerCase()];
    if (tier) return { ...DEFAULT_ENTRY, tier };
  }

  // 5. Defaults
  return DEFAULT_ENTRY;
}
