/**
 * Browser-safe mirror of `listFrameworkModelsForProvider` from `@reactive-agents/llm-provider`
 * (see `packages/llm-provider/src/model-catalog.ts` + `ModelPresets` / `PROVIDER_DEFAULT_MODELS`).
 * Used when `/api/models/framework/*` is unavailable so provider dropdown changes still work.
 *
 * When updating framework presets or defaults, update this file to match.
 */
export type LocalModelOption = { value: string; label: string };

/** Subset of {@link ModelPresets}: provider + model id only. */
const MODEL_PRESETS: Record<string, { provider: string; model: string }> = {
  "claude-haiku": { provider: "anthropic", model: "claude-3-5-haiku-20241022" },
  "claude-sonnet": { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  "claude-sonnet-4-5": { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
  "claude-opus": { provider: "anthropic", model: "claude-opus-4-20250514" },
  "gpt-4o-mini": { provider: "openai", model: "gpt-4o-mini" },
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "gemini-2.0-flash": { provider: "gemini", model: "gemini-2.0-flash" },
  "gemini-2.5-pro": { provider: "gemini", model: "gemini-2.5-pro-preview-03-25" },
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "cogito:14b",
  gemini: "gemini-2.5-flash",
  litellm: "gpt-4o",
  test: "test-model",
};

function getProviderDefaultModel(provider: string): string | undefined {
  return PROVIDER_DEFAULT_MODELS[provider];
}

function presetKeyToLabel(key: string): string {
  return key
    .split("-")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Same shape as server `GET /api/models/framework/:provider` for cloud providers.
 */
export function localFrameworkModelOptions(provider: string): LocalModelOption[] {
  const p = provider.trim();
  const seen = new Set<string>();
  const out: Array<{ name: string; label: string }> = [];

  for (const [presetKey, preset] of Object.entries(MODEL_PRESETS)) {
    if (preset.provider !== p) continue;
    const name = preset.model;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      label: `${presetKeyToLabel(presetKey)} (${name})`,
    });
  }

  if (p === "litellm") {
    const m = getProviderDefaultModel("litellm") ?? "gpt-4o";
    return [
      {
        value: m,
        label: `LiteLLM — ${m} (any model id your proxy routes)`,
      },
    ];
  }

  if (p === "test") {
    const m = getProviderDefaultModel("test") ?? "test-model";
    return [{ value: m, label: "Test model (mock LLM)" }];
  }

  if (p === "ollama" || p === "custom") {
    return [];
  }

  const def = getProviderDefaultModel(p);
  if (def && !seen.has(def)) {
    out.unshift({ name: def, label: `${def} (framework default)` });
  }

  return out.map((m) => ({ value: m.name, label: m.label }));
}
