/**
 * Model lists for UIs — derived from {@link ModelPresets} and {@link getProviderDefaultModel}.
 * Ollama is intentionally omitted (live tags from the Ollama daemon).
 */
import { getProviderDefaultModel } from "./provider-defaults.js";
import { ModelPresets } from "./types.js";

export type FrameworkModelOption = {
  /** Provider model id (API string) */
  name: string;
  /** Human-readable label */
  label: string;
};

function presetKeyToLabel(key: string): string {
  return key
    .split("-")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Returns chat/completion model options known to the framework for this provider.
 * - anthropic / openai / gemini: from {@link ModelPresets}
 * - litellm / test: synthetic entries from defaults
 * - ollama / custom: empty (caller should use Ollama tags or free text)
 */
export function listFrameworkModelsForProvider(provider: string): FrameworkModelOption[] {
  const seen = new Set<string>();
  const out: FrameworkModelOption[] = [];

  for (const [presetKey, preset] of Object.entries(ModelPresets)) {
    if (preset.provider !== provider) continue;
    const name = preset.model;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      label: `${presetKeyToLabel(presetKey)} (${name})`,
    });
  }

  if (provider === "litellm") {
    const m = getProviderDefaultModel("litellm") ?? "gpt-4o";
    return [
      {
        name: m,
        label: `LiteLLM — ${m} (any model id your proxy routes)`,
      },
    ];
  }

  if (provider === "test") {
    const m = getProviderDefaultModel("test") ?? "test-model";
    return [{ name: m, label: "Test model (mock LLM)" }];
  }

  if (provider === "ollama" || provider === "custom") {
    return [];
  }

  const def = getProviderDefaultModel(provider);
  if (def && !seen.has(def)) {
    out.unshift({ name: def, label: `${def} (framework default)` });
  }

  return out;
}
