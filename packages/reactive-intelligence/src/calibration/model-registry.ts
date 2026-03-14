import type { ModelRegistryEntry } from "../types.js";

export const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  // Ollama / local models
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

/**
 * Look up a model by ID. Resolution order:
 * 1. Exact match in built-in registry
 * 2. Prefix match in built-in registry (e.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4")
 * 3. Exact match in overrides
 * 4. Safe defaults
 */
export function lookupModel(
  id: string,
  overrides?: Record<string, ModelRegistryEntry>,
): ModelRegistryEntry {
  // 1. Exact match
  if (MODEL_REGISTRY[id]) return MODEL_REGISTRY[id]!;

  // 2. Prefix match — find longest matching key
  let bestMatch: ModelRegistryEntry | undefined;
  let bestLen = 0;
  for (const key of Object.keys(MODEL_REGISTRY)) {
    if (id.startsWith(key) && key.length > bestLen) {
      bestMatch = MODEL_REGISTRY[key]!;
      bestLen = key.length;
    }
  }
  if (bestMatch) return bestMatch;

  // 3. Overrides
  if (overrides?.[id]) return overrides[id]!;

  // 4. Defaults
  return DEFAULT_ENTRY;
}
