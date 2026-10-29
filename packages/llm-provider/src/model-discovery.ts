/**
 * Live model discovery — asks each provider which models it serves right now,
 * so UIs and the CLI need no code change per model release.
 *
 * Endpoints (auth / shape). Anthropic, OpenAI, Gemini, Groq, xAI and Ollama
 * follow each vendor's public list-models API as known at the time of writing;
 * they were NOT re-verified against live docs in the authoring session, so
 * treat a provider-side shape change as a `parse` error (resolve falls back).
 *
 * | provider  | endpoint                                             | auth                    |
 * |-----------|------------------------------------------------------|-------------------------|
 * | anthropic | GET https://api.anthropic.com/v1/models              | x-api-key + version     |
 * | openai    | GET https://api.openai.com/v1/models                 | Bearer                  |
 * | groq      | GET https://api.groq.com/openai/v1/models            | Bearer                  |
 * | xai       | GET https://api.x.ai/v1/models                       | Bearer                  |
 * | gemini    | GET https://generativelanguage.googleapis.com/v1beta/models | x-goog-api-key   |
 * | litellm   | GET {baseUrl}/v1/models                              | optional Bearer         |
 * | ollama    | GET {endpoint}/api/tags                              | none                    |
 *
 * Security: a key is attached only to the request for its own provider. The
 * five hosted providers use fixed hosts and ignore a caller-supplied `baseUrl`
 * (groq/xai honor only their own `*_BASE_URL` env, as their provider layers do).
 * Only litellm and ollama, which are self-hosted by nature, take a `baseUrl`.
 */
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { ModelDiscoveryError } from "./errors.js";
import { resolveCapability } from "./capability-resolver.js";
import { listFrameworkModelsForProvider } from "./model-catalog.js";
import { resolveOllamaEndpoint } from "./ollama-endpoint.js";

export { ModelDiscoveryError };

/** One model offered by a provider. */
export interface DiscoveredModel {
  /** API model id, as passed to `withModel`. */
  readonly id: string;
  readonly label: string;
  /** `live` = returned by the provider just now; `preset` = framework catalog. */
  readonly source: "live" | "preset";
  readonly contextWindow?: number;
  /** From the capability resolver; `null` when the model is unknown to it. */
  readonly supportsThinking: boolean | null;
}

/** Options for {@link listProviderModels} / {@link resolveProviderModels}. */
export interface ListProviderModelsOptions {
  /** Overrides the provider's env var. Sent only to that provider's own endpoint. */
  readonly apiKey?: string;
  /** Honored for `litellm` and `ollama` only. */
  readonly baseUrl?: string;
  /** Default 5000. */
  readonly timeoutMs?: number;
  /** Injectable for tests. */
  readonly fetch?: typeof fetch;
}

/** Result of {@link resolveProviderModels}; never a failure. */
export interface ResolvedProviderModels {
  readonly models: readonly DiscoveredModel[];
  /** True when the provider answered; false when only presets are shown. */
  readonly live: boolean;
  /** Why discovery failed, when `live` is false and a fetch was needed. */
  readonly error?: ModelDiscoveryError;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_PAGES = 20;
const ANTHROPIC_VERSION = "2023-06-01";

const KEY_ENV: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  litellm: "LITELLM_API_KEY",
};

// ─── Chat-capable filter ───

/**
 * Non-chat id patterns per provider (embedding, TTS, transcription, image,
 * moderation/guard, realtime). Anything unmatched is kept: an unknown new
 * model should be listed, not hidden.
 */
const NON_CHAT: Readonly<Record<string, readonly RegExp[]>> = {
  openai: [
    /^text-embedding-/, /^tts-/, /^whisper-/, /^dall-e-/, /moderation/,
    /realtime/, /^gpt-image-/, /^sora-/, /transcribe/, /-tts(-|$)/, /^davinci-|^babbage-/,
  ],
  groq: [/whisper/, /tts/, /guard/, /embed/],
  xai: [/image/, /imagine/, /video/, /embed/],
  gemini: [/embedding/, /^imagen-/, /^veo-/, /^aqa$/, /tts/, /-image/, /^learnlm-/],
  ollama: [/embed/, /^bge-/, /^all-minilm/, /^snowflake-arctic-embed/, /^mxbai-embed/],
  litellm: [/embed/, /^tts-/, /^whisper-/, /^dall-e-/, /moderation/, /realtime/],
  anthropic: [],
};

/**
 * True when `id` looks like a chat/completion model for `provider`.
 * Pure; denylist documented in {@link NON_CHAT}.
 */
export function isChatModel(provider: string, id: string): boolean {
  const lower = id.toLowerCase();
  return !(NON_CHAT[provider] ?? []).some((re) => re.test(lower));
}

// ─── Parsing helpers (no `any`) ───

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

interface RawModel {
  readonly id: string;
  readonly label?: string;
  readonly contextWindow?: number;
}
interface Page {
  readonly models: readonly RawModel[];
  /** URL of the next page, if any. */
  readonly next?: string;
}

const errorMessage = (e: unknown): string =>
  isRec(e) && typeof e.message === "string" ? e.message : "network error";

const fail = (
  provider: string,
  reason: ModelDiscoveryError["reason"],
  message: string,
  status?: number,
): ModelDiscoveryError =>
  new ModelDiscoveryError({ provider, reason, message, ...(status !== undefined ? { status } : {}) });

const parseErr = (provider: string): ModelDiscoveryError =>
  fail(provider, "parse", `${provider} returned an unexpected model-list shape`);

function parseOpenAIStyle(provider: string, body: unknown): Page | ModelDiscoveryError {
  if (!isRec(body) || !Array.isArray(body.data)) return parseErr(provider);
  const models: RawModel[] = [];
  for (const m of body.data) {
    // Groq (console.groq.com/docs/api-reference) flags each entry `active`;
    // `false` = deprecated/unavailable. Other OpenAI-style hosts omit the flag.
    if (isRec(m) && m.active === false) continue;
    const id = isRec(m) ? str(m.id) : undefined;
    if (id) models.push({ id });
  }
  return { models };
}

function parseAnthropic(provider: string, body: unknown, urlOf: (after: string) => string): Page | ModelDiscoveryError {
  if (!isRec(body) || !Array.isArray(body.data)) return parseErr(provider);
  const models: RawModel[] = [];
  for (const m of body.data) {
    if (!isRec(m)) continue;
    const id = str(m.id);
    if (id) models.push({ id, ...(str(m.display_name) ? { label: str(m.display_name)! } : {}) });
  }
  const last = str(body.last_id);
  return body.has_more === true && last ? { models, next: urlOf(last) } : { models };
}

function parseGemini(provider: string, body: unknown, urlOf: (token: string) => string): Page | ModelDiscoveryError {
  if (!isRec(body) || !Array.isArray(body.models)) return parseErr(provider);
  const models: RawModel[] = [];
  for (const m of body.models) {
    if (!isRec(m)) continue;
    const name = str(m.name);
    const methods = m.supportedGenerationMethods;
    if (!name || !Array.isArray(methods) || !methods.includes("generateContent")) continue;
    const ctx = num(m.inputTokenLimit);
    models.push({
      id: name.replace(/^models\//, ""),
      ...(str(m.displayName) ? { label: str(m.displayName)! } : {}),
      ...(ctx !== undefined ? { contextWindow: ctx } : {}),
    });
  }
  const token = str(body.nextPageToken);
  return token ? { models, next: urlOf(token) } : { models };
}

function parseOllama(provider: string, body: unknown): Page | ModelDiscoveryError {
  if (!isRec(body) || !Array.isArray(body.models)) return parseErr(provider);
  const models: RawModel[] = [];
  for (const m of body.models) {
    const id = isRec(m) ? (str(m.name) ?? str(m.model)) : undefined;
    if (id) models.push({ id });
  }
  return { models };
}

// ─── Request plan per provider ───

interface Plan {
  readonly firstUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly parse: (body: unknown) => Page | ModelDiscoveryError;
}

const trimSlash = (u: string): string => u.replace(/\/+$/, "");
const envOf = (name: string): string | undefined => {
  const v = process.env[name];
  return v !== undefined && v.trim().length > 0 ? v.trim() : undefined;
};

function planFor(provider: string, apiKey: string | undefined, opts: ListProviderModelsOptions): Plan | ModelDiscoveryError {
  const bearer: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  switch (provider) {
    case "anthropic": {
      const base = "https://api.anthropic.com/v1/models?limit=1000";
      return {
        firstUrl: base,
        headers: { "x-api-key": apiKey ?? "", "anthropic-version": ANTHROPIC_VERSION },
        parse: (b) => parseAnthropic(provider, b, (after) => `${base}&after_id=${encodeURIComponent(after)}`),
      };
    }
    case "openai":
      return { firstUrl: "https://api.openai.com/v1/models", headers: bearer, parse: (b) => parseOpenAIStyle(provider, b) };
    case "groq":
      return {
        firstUrl: `${trimSlash(envOf("GROQ_BASE_URL") ?? "https://api.groq.com/openai/v1")}/models`,
        headers: bearer,
        parse: (b) => parseOpenAIStyle(provider, b),
      };
    case "xai":
      return {
        firstUrl: `${trimSlash(envOf("XAI_BASE_URL") ?? "https://api.x.ai/v1")}/models`,
        headers: bearer,
        parse: (b) => parseOpenAIStyle(provider, b),
      };
    case "gemini": {
      const base = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000";
      return {
        firstUrl: base,
        headers: { "x-goog-api-key": apiKey ?? "" },
        parse: (b) => parseGemini(provider, b, (t) => `${base}&pageToken=${encodeURIComponent(t)}`),
      };
    }
    case "litellm": {
      const base = trimSlash(opts.baseUrl ?? envOf("LITELLM_BASE_URL") ?? "http://localhost:4000");
      return { firstUrl: `${base}/v1/models`, headers: bearer, parse: (b) => parseOpenAIStyle(provider, b) };
    }
    case "ollama":
      return { firstUrl: `${resolveOllamaEndpoint(opts.baseUrl)}/api/tags`, headers: {}, parse: (b) => parseOllama(provider, b) };
    default:
      return fail(provider, "unreachable", `no model listing endpoint for provider "${provider}"`);
  }
}

// ─── Cache (successes only; key never stored raw) ───

interface CacheEntry {
  readonly at: number;
  readonly models: readonly DiscoveredModel[];
}
const cache = new Map<string, CacheEntry>();

/** One-way digest so distinct credentials get distinct entries without storing the key. */
const digest = (key: string | undefined): string =>
  key ? createHash("sha256").update(key).digest("hex") : "none";

/** Drops every cached listing (e.g. for a UI "refresh" action or tests). */
export function clearModelDiscoveryCache(): void {
  cache.clear();
}

// ─── Fetching ───

function fetchPage(
  provider: string,
  url: string,
  headers: Readonly<Record<string, string>>,
  doFetch: typeof fetch,
  timeoutMs: number,
): Effect.Effect<unknown, ModelDiscoveryError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const res = await doFetch(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal, redirect: "error" });
      return res;
    },
    catch: (e) =>
      fail(provider, "unreachable", `${provider} model list unreachable: ${errorMessage(e)}`),
  }).pipe(
    Effect.timeoutFail({
      duration: timeoutMs,
      onTimeout: () => fail(provider, "unreachable", `${provider} model list timed out after ${timeoutMs}ms`),
    }),
    Effect.flatMap((res) => {
      const response = res as Response;
      if (!response.ok) {
        return Effect.fail(fail(provider, "http", `${provider} model list returned HTTP ${response.status}`, response.status));
      }
      return Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () => parseErr(provider),
      });
    }),
  );
}

const toModel = (provider: string, raw: RawModel): DiscoveredModel => {
  const cap = resolveCapability(provider, raw.id);
  const known = cap.source !== "fallback";
  const ctx = raw.contextWindow ?? (known ? cap.maxContextTokens : undefined);
  return {
    id: raw.id,
    label: raw.label ?? raw.id,
    source: "live",
    ...(ctx !== undefined ? { contextWindow: ctx } : {}),
    supportsThinking: known ? cap.supportsThinkingMode : null,
  };
};

/**
 * Lists the chat models `provider` currently serves.
 *
 * Credentials come from `opts.apiKey` or the provider's env var and go only to
 * that provider's own endpoint. Successful listings are cached for 10 minutes
 * per (provider, endpoint, credential digest); failures are never cached.
 */
export function listProviderModels(
  provider: string,
  opts: ListProviderModelsOptions = {},
): Effect.Effect<readonly DiscoveredModel[], ModelDiscoveryError> {
  return Effect.suspend(() => {
    if (provider === "test") {
      return Effect.succeed(presetModels("test"));
    }
    const envName = KEY_ENV[provider];
    // Env credentials only go to the endpoint the operator configured: for litellm a
    // caller-named baseUrl gets the env key only when it equals LITELLM_BASE_URL.
    const envBase = envOf("LITELLM_BASE_URL");
    const envKeyAllowed =
      provider !== "litellm" ||
      opts.baseUrl === undefined ||
      (envBase !== undefined && trimSlash(opts.baseUrl) === trimSlash(envBase));
    const apiKey = opts.apiKey?.trim() || (envName && envKeyAllowed ? envOf(envName) : undefined);
    const keyRequired = provider !== "litellm" && provider !== "ollama";
    if (keyRequired && !apiKey && KEY_ENV[provider] !== undefined) {
      return Effect.fail(fail(provider, "no-credentials", `${provider} needs ${envName}; none set`));
    }
    const plan = planFor(provider, apiKey, opts);
    if ("_tag" in plan) return Effect.fail(plan);

    const cacheKey = `${provider}|${plan.firstUrl}|${digest(apiKey)}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Effect.succeed(hit.models);

    const doFetch = opts.fetch ?? fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return Effect.gen(function* () {
      const raws: RawModel[] = [];
      let url: string | undefined = plan.firstUrl;
      for (let page = 0; url !== undefined && page < MAX_PAGES; page++) {
        const body = yield* fetchPage(provider, url, plan.headers, doFetch, timeoutMs);
        const parsed = plan.parse(body);
        if ("_tag" in parsed) return yield* Effect.fail(parsed);
        raws.push(...parsed.models);
        url = parsed.next;
      }
      const seen = new Set<string>();
      const models = raws
        .filter((m) => isChatModel(provider, m.id) && !seen.has(m.id) && seen.add(m.id))
        .map((m) => toModel(provider, m));
      cache.set(cacheKey, { at: Date.now(), models });
      return models;
    });
  });
}

function presetModels(provider: string): readonly DiscoveredModel[] {
  return listFrameworkModelsForProvider(provider).map((p) => {
    const cap = resolveCapability(provider, p.name);
    const known = cap.source !== "fallback";
    return {
      id: p.name,
      label: p.label,
      source: "preset" as const,
      ...(known ? { contextWindow: cap.maxContextTokens } : {}),
      supportsThinking: known ? cap.supportsThinkingMode : null,
    };
  });
}

/**
 * The call apps should use. Merges live results with the framework presets
 * (live first, presets not already listed after, deduplicated by id). When
 * discovery fails it returns presets only with `live: false` and the reason.
 * Never fails.
 */
export function resolveProviderModels(
  provider: string,
  opts: ListProviderModelsOptions = {},
): Effect.Effect<ResolvedProviderModels> {
  return listProviderModels(provider, opts).pipe(
    Effect.map((live): ResolvedProviderModels => {
      const seen = new Set(live.map((m) => m.id));
      const extra = presetModels(provider).filter((m) => !seen.has(m.id));
      return { models: [...live, ...extra], live: provider !== "test" };
    }),
    Effect.catchAll((error) => Effect.succeed<ResolvedProviderModels>({ models: presetModels(provider), live: false, error })),
  );
}
