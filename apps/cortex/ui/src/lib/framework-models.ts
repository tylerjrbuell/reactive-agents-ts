/**
 * Model dropdown data from `GET /api/models/:provider` (live discovery merged with
 * framework presets, server-side). When the API is unreachable or returns non-JSON
 * (e.g. SPA shell), falls back to `localFrameworkModelOptions` (mirrors the catalog).
 */
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import {
  localFrameworkModelOptions,
  localProviderDefaultModel,
  modelsFallbackNote,
} from "$lib/framework-model-options-local.js";
import { settings } from "$lib/stores/settings.js";
import { formatModelPrice, type ModelPrice } from "@reactive-agents/ui-core";

/**
 * `thinking`: true = the model has a thinking mode, false = it does not, null/absent = not known.
 * `price`: $/1M rates from the framework PriceBook (server `GET /api/models/:provider`); absent = price unknown.
 */
export type UiModelOption = { value: string; label: string; thinking?: boolean | null; price?: ModelPrice };

/** Dropdown text for a model: its label, a thinking note, and its $/1M price (ui-core `formatModelPrice`). */
export function modelOptionLabel(m: UiModelOption): string {
  return `${m.label}${m.thinking ? " (thinking)" : ""} · ${formatModelPrice(m.price)}`;
}

/** `default` is the framework's current provider-default model id (when known). */
export type FetchModelsResult = {
  options: UiModelOption[];
  default?: string;
  error?: string;
  /** Non-fatal hint, e.g. "Showing built-in list (…)" when live discovery failed. */
  note?: string;
};

type ModelRow = { name: string; label: string; supportsThinking?: boolean | null; price?: ModelPrice };

type ModelsBody = {
  models?: ModelRow[];
  live?: boolean;
  error?: { reason: string; message: string };
  default?: string | null;
};

/** Map `/api/models/:provider` rows to dropdown options. Exported for tests. */
export function mapFrameworkBody(data: { models?: ModelRow[] }): UiModelOption[] {
  return (data.models ?? []).map((m) => ({
    value: m.name,
    label: m.label,
    ...(m.supportsThinking !== undefined ? { thinking: m.supportsThinking } : {}),
    ...(m.price ? { price: m.price } : {}),
  }));
}

/**
 * One loader for every provider: `GET /api/models/:provider` (Ollama and LiteLLM
 * take the user's endpoint). Server falls back to presets itself; `live:false`
 * becomes a "showing built-in list" note, never an error.
 */
export async function fetchModelsForProvider(
  provider: string,
  endpointOverride?: string,
): Promise<FetchModelsResult> {
  const p = provider.trim();
  if (p === "ollama") settings.init();
  const ep = (endpointOverride ?? (p === "ollama" ? settings.get().ollamaEndpoint : undefined) ?? "").trim();
  const qs = ep && (p === "ollama" || p === "litellm") ? `?endpoint=${encodeURIComponent(ep)}` : "";

  const local = p === "ollama" ? [] : localFrameworkModelOptions(p);
  const localDef = localProviderDefaultModel(p);
  const offline = (error: string): FetchModelsResult =>
    local.length > 0 ? { options: local, default: localDef } : { options: [], error };

  try {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/models/${encodeURIComponent(p)}${qs}`);
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!res.ok) return offline(`Server returned ${res.status}`);
    if (!ct.includes("json")) {
      return offline("Cortex API returned a non-JSON response. Use the Vite dev URL (proxied /api) or open the app from the Cortex server port.");
    }
    const data = (await res.json()) as ModelsBody;
    const options = mapFrameworkBody(data);
    const live = data.live ?? true;
    const note = modelsFallbackNote(live, data.error, options.length);
    return {
      options,
      default: data.default ?? localDef,
      ...(note ? { note } : {}),
    };
  } catch {
    return offline(p === "ollama" ? "Could not reach Ollama" : "Could not reach Cortex server");
  }
}
