// packages/llm-provider/src/model-support-consistency.test.ts
// Run: bun test packages/llm-provider/src/model-support-consistency.test.ts --timeout 15000
//
// Invariant guard: every cloud-provider default model and every ModelPreset
// MUST have a matching entry in STATIC_CAPABILITIES (capability.ts). Cloud
// providers have no live probe, so a model id without a static entry resolves
// to the conservative 2048-ctx fallback (`source: "fallback"`) and fires the
// capability-source build warning. This test fails loudly on model-id drift —
// e.g. shipping a default/preset that points at a retired or unlisted model.
import { describe, it, expect } from "bun:test";
import { resolveCapability } from "./capability-resolver.js";
import { PROVIDER_DEFAULT_MODELS } from "./provider-defaults.js";
import { ModelPresets } from "./types.js";

// Only providers with a static capability table. litellm (proxy, arbitrary
// model ids), ollama (probe-on-use), and test are intentionally excluded.
const STATIC_PROVIDERS = new Set(["anthropic", "openai", "gemini"]);

describe("model-support consistency (defaults + presets ⊆ STATIC_CAPABILITIES)", () => {
  it("every cloud-provider default model has a static-table capability", () => {
    const failures: string[] = [];
    for (const [provider, model] of Object.entries(PROVIDER_DEFAULT_MODELS)) {
      if (!STATIC_PROVIDERS.has(provider)) continue;
      const cap = resolveCapability(provider, model);
      if (cap.source !== "static-table") {
        failures.push(`${provider}/${model} (source=${cap.source})`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("every ModelPreset model has a static-table capability", () => {
    const failures: string[] = [];
    for (const [key, preset] of Object.entries(ModelPresets)) {
      if (!STATIC_PROVIDERS.has(preset.provider)) continue;
      const cap = resolveCapability(preset.provider, preset.model);
      if (cap.source !== "static-table") {
        failures.push(`preset "${key}" -> ${preset.provider}/${preset.model} (source=${cap.source})`);
      }
    }
    expect(failures).toEqual([]);
  });
});
