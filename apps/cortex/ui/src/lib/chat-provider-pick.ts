/**
 * The chat provider picker's rules: which providers cannot be chosen (and why), and which
 * model a provider switch lands on. Pure apart from `loadProviderBlocks`, which reads the
 * key status and Ollama's model list.
 */
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { providerKeysApi, type ProviderKeyStatus } from "./provider-keys.js";
import { fetchModelsForProvider, type FetchModelsResult, type UiModelOption } from "./framework-models.js";

/** Provider id to the reason it cannot be picked. A provider absent from the map is selectable. */
export type ProviderBlocks = Readonly<Record<string, string>>;

/** Providers that need no API key (an unreachable server is checked separately for Ollama). */
const KEYLESS: ReadonlySet<string> = new Set(["ollama", "litellm", "test"]);

/**
 * Reasons from the key status (keyed providers with no stored or environment key) and
 * Ollama's reachability (`null` = not checked, so it stays selectable).
 */
export function providerBlocks(keys: readonly ProviderKeyStatus[] | null, ollamaReachable: boolean | null): ProviderBlocks {
  const out: Record<string, string> = {};
  for (const k of keys ?? []) {
    if (!KEYLESS.has(k.provider) && k.source === "none") {
      out[k.provider] = k.unreadable ? "stored key unreadable, set it again in Settings" : `no API key configured (${k.env[0] ?? "Settings"})`;
    }
  }
  if (ollamaReachable === false) out.ollama = "Ollama not reachable";
  return out;
}

/** Read the blocks from the server. A failed read blocks nothing: the picker must never lock out on a lookup error. */
export async function loadProviderBlocks(base: string = CORTEX_SERVER_URL, doFetch: typeof fetch = fetch, models: typeof fetchModelsForProvider = fetchModelsForProvider): Promise<ProviderBlocks> {
  const [keys, ollama] = await Promise.all([
    providerKeysApi(base, doFetch).list().then((r) => (r.ok ? r.value.providers : null)).catch(() => null),
    models("ollama").then((r) => r.options.length > 0 || r.error === undefined).catch(() => null),
  ]);
  return providerBlocks(keys, ollama);
}

/** The model after a provider switch: keep the current one when the new provider lists it, else its default, else its first. */
export function modelAfterProviderSwitch(current: string, options: readonly UiModelOption[], providerDefault: string | undefined): string | undefined {
  if (current && options.some((o) => o.value === current)) return current;
  return providerDefault ?? options[0]?.value;
}

/** Patch and toast copy for switching to `next` (model list fetched through `fetchModels`). */
export async function providerSwitch(
  next: string,
  currentModel: string,
  fetchModels: (provider: string) => Promise<FetchModelsResult> = fetchModelsForProvider,
): Promise<{ label: string; patch: Record<string, unknown>; needsModel: boolean }> {
  const r = await fetchModels(next).catch((): FetchModelsResult => ({ options: [] }));
  const model = modelAfterProviderSwitch(currentModel, r.options, r.default);
  return { label: `Provider ${next}${model ? `, model ${model}` : ""}`, patch: { provider: next, ...(model ? { model } : {}) }, needsModel: !model };
}
