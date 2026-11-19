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

/** Where a model row came from (framework `DiscoveredModel.listedBy`). */
export type ModelListedBy = "live" | "static" | "price-book";

/**
 * `thinking`: true = the model has a thinking mode, false = it does not, null/absent = not known.
 * `price`: $/1M rates from the framework PriceBook (server `GET /api/models/:provider`); absent = price unknown.
 * `listedBy`: `price-book` rows are known ids the provider did not confirm (listed only when its live list failed).
 */
export type UiModelOption = {
  value: string;
  label: string;
  thinking?: boolean | null;
  price?: ModelPrice;
  listedBy?: ModelListedBy;
};

/** Picker section for model rows the provider did not confirm (PriceBook ids shown when its live list failed). */
export const UNCONFIRMED_MODELS_GROUP = "Known models (not confirmed live)";

/** Dropdown text for a model: its label, a thinking note, and its $/1M price (ui-core `formatModelPrice`). */
export function modelOptionLabel(m: UiModelOption): string {
  return `${m.label}${m.thinking ? " (thinking)" : ""} · ${formatModelPrice(m.price)}`;
}

/** A model as a kit `Select` option: PriceBook-only rows go under {@link UNCONFIRMED_MODELS_GROUP}. */
export function modelSelectOption(m: UiModelOption): { value: string; label: string; group?: string } {
  return {
    value: m.value,
    label: modelOptionLabel(m),
    ...(m.listedBy === "price-book" ? { group: UNCONFIRMED_MODELS_GROUP } : {}),
  };
}

/** `default` is the framework's current provider-default model id (when known). */
export type FetchModelsResult = {
  options: UiModelOption[];
  default?: string;
  error?: string;
  /** Non-fatal hint, e.g. "Live list unavailable (…); showing known models." when live discovery failed. */
  note?: string;
};

type ModelRow = {
  name: string;
  label: string;
  supportsThinking?: boolean | null;
  price?: ModelPrice;
  listedBy?: ModelListedBy;
};

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
    ...(m.listedBy ? { listedBy: m.listedBy } : {}),
  }));
}

/**
 * One loader for every provider: `GET /api/models/:provider` (Ollama and LiteLLM
 * take the user's endpoint). Server falls back to presets itself; `live:false`
 * becomes a "showing known models" note, never an error.
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
    const note = modelsFallbackNote(live, data.error, options.length, p);
    return {
      options,
      default: data.default ?? localDef,
      ...(note ? { note } : {}),
    };
  } catch {
    return offline(p === "ollama" ? "Could not reach Ollama" : "Could not reach Cortex server");
  }
}
