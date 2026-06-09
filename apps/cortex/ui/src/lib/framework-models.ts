/**
 * Model dropdown data from the Cortex API (framework presets + Ollama tags).
 * When `/api/models/framework/*` is unreachable or returns non-JSON (e.g. SPA shell),
 * falls back to `localFrameworkModelOptions` (mirrors `@reactive-agents/llm-provider` catalog).
 */
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import {
  localFrameworkModelOptions,
  localProviderDefaultModel,
} from "$lib/framework-model-options-local.js";
import { settings } from "$lib/stores/settings.js";

export type UiModelOption = { value: string; label: string };

/** `default` is the framework's current provider-default model id (when known). */
export type FetchModelsResult = { options: UiModelOption[]; default?: string; error?: string };

function mapFrameworkBody(data: { models?: { name: string; label: string }[] }): UiModelOption[] {
  return (data.models ?? []).map((m) => ({ value: m.name, label: m.label }));
}

/**
 * Static model ids from `@reactive-agents/llm-provider` (ModelPresets + defaults).
 */
export async function fetchFrameworkModels(provider: string): Promise<FetchModelsResult> {
  const p = provider.trim();
  if (p === "ollama") {
    return { options: [] };
  }

  const local = localFrameworkModelOptions(p);
  const localDef = localProviderDefaultModel(p);

  try {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/models/framework/${encodeURIComponent(p)}`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    const looksJson = ct.includes("json") || ct.includes("application/json");

    if (!res.ok) {
      if (local.length > 0) return { options: local, default: localDef };
      return { options: [], error: `Server returned ${res.status}` };
    }

    if (!looksJson) {
      if (local.length > 0) return { options: local, default: localDef };
      return {
        options: [],
        error: "Cortex API returned a non-JSON response. Use the Vite dev URL (proxied /api) or open the app from the Cortex server port.",
      };
    }

    const data = (await res.json()) as {
      models?: { name: string; label: string }[];
      default?: string | null;
    };
    const fromApi = mapFrameworkBody(data);
    const def = data.default ?? undefined;
    if (fromApi.length > 0) return { options: fromApi, default: def };
    if (local.length > 0) return { options: local, default: def ?? localDef };
    return { options: [], default: def ?? localDef };
  } catch {
    if (local.length > 0) return { options: local, default: localDef };
    return { options: [], error: "Could not reach Cortex server" };
  }
}

/**
 * Tags from the user’s Ollama daemon (via Cortex proxy).
 */
export async function fetchOllamaModelOptions(endpoint?: string): Promise<FetchModelsResult> {
  settings.init();
  const ep = (endpoint ?? settings.get().ollamaEndpoint ?? "").trim();
  const url = ep
    ? `${CORTEX_SERVER_URL}/api/models/ollama?endpoint=${encodeURIComponent(ep)}`
    : `${CORTEX_SERVER_URL}/api/models/ollama`;
  try {
    const res = await fetch(url);
    const data = (await res.json()) as {
      models?: { name: string; label: string }[];
      error?: string;
    };
    if (data.error) {
      return { options: [], error: data.error };
    }
    return {
      options: (data.models ?? []).map((m) => ({ value: m.name, label: m.label })),
    };
  } catch {
    return { options: [], error: "Could not reach Ollama" };
  }
}

/** Dropdown options: framework list for cloud providers; live Ollama tags when provider is ollama. */
export async function fetchModelsForProvider(
  provider: string,
  ollamaEndpointOverride?: string,
): Promise<FetchModelsResult> {
  if (provider === "ollama") {
    return fetchOllamaModelOptions(ollamaEndpointOverride);
  }
  return fetchFrameworkModels(provider);
}
