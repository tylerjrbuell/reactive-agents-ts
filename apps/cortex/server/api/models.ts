/**
 * /api/models — model lists per provider, one code path.
 * - /:provider — `resolveProviderModels` (live discovery merged with framework presets; falls back to presets)
 * - /framework/:provider, /ollama — thin aliases of /:provider
 * - /providers — provider ids derived from the framework `LLMProviderType`
 */
import {
  getProviderDefaultModel,
  resolveProviderModels,
  LLMProviderType,
  type DiscoveredModel,
  type ListProviderModelsOptions,
  type ResolvedProviderModels,
} from "@reactive-agents/llm-provider";
import { Effect } from "effect";
import { Elysia } from "elysia";

/** One model in the `/api/models/:provider` response. */
export interface ModelEntry {
  readonly name: string;
  readonly label: string;
  readonly source: "live" | "preset";
  /** true/false from the framework (or Ollama api/show); null = unknown. */
  readonly supportsThinking: boolean | null;
}

/** Response of `GET /api/models/:provider`. */
export interface ModelsResponse {
  readonly models: readonly ModelEntry[];
  /** False when the provider could not be asked and only built-in presets are listed. */
  readonly live: boolean;
  /** Why discovery failed (present when `live` is false and a fetch was needed). */
  readonly error?: { readonly reason: string; readonly message: string };
  /** Framework provider-default model id, or null. */
  readonly default: string | null;
}

/** Injectable seams (tests run with no keys and no network). */
export interface ModelsDeps {
  readonly resolve: (provider: string, opts: ListProviderModelsOptions) => Promise<ResolvedProviderModels>;
  readonly fetch: typeof fetch;
}

const defaultDeps: ModelsDeps = {
  resolve: (provider, opts) => Effect.runPromise(resolveProviderModels(provider, opts)),
  fetch,
};

/** One selectable LLM provider in Cortex pickers. */
export interface ProviderInfo {
  readonly id: string;
  readonly label: string;
  /** Runs on the user's machine / network (no hosted API key). */
  readonly local: boolean;
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  ollama: "Ollama (local)",
  litellm: "LiteLLM",
  groq: "Groq",
  xai: "xAI",
  test: "Test (deterministic)",
};
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "litellm", "test"]);

/**
 * Providers Cortex can run: every framework `LLMProviderType` literal except `custom`
 * (matching runtime `ProviderNameSchema`), plus the deterministic `test` provider.
 * A new framework provider shows up here with no Cortex edit.
 */
export function listProviders(): readonly ProviderInfo[] {
  const ids = [...LLMProviderType.literals.filter((p) => p !== "custom"), "test"];
  return ids.map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id, local: LOCAL_PROVIDERS.has(id) }));
}

const OLLAMA_DEFAULT = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/** Ollama reports a model's capabilities (`completion`, `tools`, `thinking`, …) via /api/show. Cached per endpoint + model name. */
const ollamaThinkingCache = new Map<string, boolean | null>();
async function ollamaSupportsThinking(doFetch: typeof fetch, baseUrl: string, name: string): Promise<boolean | null> {
  const key = `${baseUrl}|${name}`;
  const hit = ollamaThinkingCache.get(key);
  if (hit !== undefined) return hit;
  let result: boolean | null = null;
  try {
    const res = await doFetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const show = (await res.json()) as { capabilities?: unknown };
      if (Array.isArray(show.capabilities)) result = show.capabilities.includes("thinking");
    }
  } catch {
    /* unreachable or slow: leave unknown, do not cache */
    return null;
  }
  ollamaThinkingCache.set(key, result);
  return result;
}


const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const stripSlash = (u: string): string => u.replace(/\/+$/, "");

/** True when a caller-supplied litellm endpoint is http(s) and configured or loopback. */
export function isAllowedLitellmEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const configured = process.env.LITELLM_BASE_URL?.trim();
  if (configured && stripSlash(endpoint) === stripSlash(configured)) return true;
  return LOOPBACK_HOSTS.has(url.hostname);
}

/** Thrown-free signal for a rejected endpoint. */
const BAD_ENDPOINT = { error: "endpoint not allowed" } as const;

/**
 * Resolve one provider's model list. Ollama models additionally get the
 * per-model `api/show` thinking probe (the capability table can't know local tags).
 */
export async function buildModelsResponse(
  provider: string,
  endpoint: string | undefined,
  deps: ModelsDeps = defaultDeps,
): Promise<ModelsResponse> {
  const baseUrl = provider === "ollama" ? endpoint || OLLAMA_DEFAULT : provider === "litellm" ? endpoint || undefined : undefined;
  const resolved = await deps.resolve(provider, { ...(baseUrl ? { baseUrl } : {}), fetch: deps.fetch });
  const toEntry = async (m: DiscoveredModel): Promise<ModelEntry> => ({
    name: m.id,
    label: m.label,
    source: m.source,
    supportsThinking:
      provider === "ollama" && m.source === "live" && baseUrl
        ? await ollamaSupportsThinking(deps.fetch, baseUrl, m.id)
        : m.supportsThinking,
  });
  const models = await Promise.all(resolved.models.map(toEntry));
  return {
    models,
    live: resolved.live,
    ...(resolved.error ? { error: { reason: resolved.error.reason, message: resolved.error.message } } : {}),
    // Cortex does not hardcode a default; the UI seeds from the framework's current one.
    default: getProviderDefaultModel(provider) ?? null,
  };
}

/** Build the models router; `deps` lets tests inject discovery and fetch. */
export function createModelsRouter(deps: ModelsDeps = defaultDeps) {
  const forProvider = async (
    raw: string | undefined,
    endpoint: string | undefined,
    set: { status?: number | string },
  ) => {
    const provider = decodeURIComponent(raw ?? "").trim();
    const ep = endpoint?.trim() || undefined;
    if (provider === "litellm" && ep !== undefined && !isAllowedLitellmEndpoint(ep)) {
      set.status = 400;
      return BAD_ENDPOINT;
    }
    return buildModelsResponse(provider, ep, deps);
  };
  const endpointOf = (q: unknown): string | undefined =>
    typeof q === "object" && q !== null && "endpoint" in q && typeof q.endpoint === "string" ? q.endpoint : undefined;
  return new Elysia({ prefix: "/api/models" })
    .get("/providers", () => ({ providers: listProviders() }))
    .get("/framework/:provider", ({ params, query, set }) => forProvider(params.provider, endpointOf(query), set))
    .get("/ollama", ({ query, set }) => forProvider("ollama", endpointOf(query), set))
    .get("/:provider", ({ params, query, set }) => forProvider(params.provider, endpointOf(query), set));
}

export const modelsRouter = createModelsRouter();
