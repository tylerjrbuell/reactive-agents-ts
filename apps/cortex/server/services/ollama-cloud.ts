/**
 * Ollama Cloud (or any remote / authenticated Ollama) for Cortex: the endpoint setting, and
 * the rule for where the API key may go.
 *
 * What the framework does today (llm-provider):
 * - The key: `.withProvider("ollama", { apiKey })` reaches the adapter and is sent as
 *   `Authorization: Bearer` (`providers/local.ts`); the env form is `OLLAMA_API_KEY`.
 * - The endpoint: only `OLLAMA_ENDPOINT` / `OLLAMA_HOST` / `OLLAMA_BASE` (`ollama-endpoint.ts`),
 *   read each time a provider layer or probe is built. `providerConfig.baseUrl` is ignored by the
 *   Ollama adapter (framework gap, reported for provider-warden). Until that lands, a Cortex
 *   endpoint setting reaches every run, chat, utility agent and probe through
 *   `OLLAMA_ENDPOINT`, set by {@link applyOllamaEndpoint}. That is one server-wide process
 *   value on purpose (Cortex has one Ollama endpoint), restored when the setting is cleared.
 * - Model listing: `listProviderModels("ollama")` takes `baseUrl` but sends no auth header (gap).
 *   Cortex passes a `fetch` that adds the bearer ({@link bearerFetch}) for the configured host only.
 *
 * Key rule: a saved Ollama key is sent only when the effective endpoint is not loopback
 * ({@link ollamaKeyApplies}); a local server needs none, so the key never goes to localhost.
 */
import { resolveOllamaEndpoint } from "@reactive-agents/llm-provider";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The one-click Ollama Cloud endpoint. */
export const OLLAMA_CLOUD_ENDPOINT = "https://ollama.com";
/** File (beside the DB) holding the saved endpoint. Not a secret. */
export const OLLAMA_SETTINGS_FILE = "ollama-settings.json";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/** Parse an http(s) endpoint to its normalised form (no trailing slash), or undefined. */
export function normalizeOllamaEndpoint(raw: string): string | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return withScheme.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** True when `endpoint` points at this machine (so no API key is needed or sent). */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

/** True when `endpoint` is Ollama Cloud. */
export const isOllamaCloud = (endpoint: string): boolean => {
  try {
    return new URL(endpoint).hostname === new URL(OLLAMA_CLOUD_ENDPOINT).hostname;
  } catch {
    return false;
  }
};

/** Persisted Cortex Ollama settings. */
export class OllamaEndpointStore {
  private readonly file: string;
  constructor(readonly dir: string) {
    this.file = join(dir, OLLAMA_SETTINGS_FILE);
  }

  /** The saved endpoint, or undefined (unset or unreadable). */
  get(): string | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const v: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      const ep = typeof v === "object" && v !== null && "endpoint" in v ? (v as { endpoint: unknown }).endpoint : undefined;
      return typeof ep === "string" ? normalizeOllamaEndpoint(ep) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Save (or clear with undefined) the endpoint; atomic write. Returns false on an I/O failure. */
  set(endpoint: string | undefined): boolean {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ endpoint: endpoint ?? null }), { mode: 0o600 });
      renameSync(tmp, this.file);
      return true;
    } catch {
      return false;
    }
  }
}

let installed: OllamaEndpointStore | null = null;
/** `OLLAMA_ENDPOINT` as the server found it when the store was installed; restored on uninstall or clear. */
let envBefore: { readonly captured: boolean; readonly value: string | undefined } = { captured: false, value: undefined };

const restoreEnv = (): void => {
  if (!envBefore.captured) return;
  if (envBefore.value === undefined) delete process.env.OLLAMA_ENDPOINT;
  else process.env.OLLAMA_ENDPOINT = envBefore.value;
};

/** Install the server's store (called once by `startCortexServer`); null uninstalls (tests) and restores the env. */
export function installOllamaEndpointStore(store: OllamaEndpointStore | null): void {
  if (store === null) {
    restoreEnv();
    envBefore = { captured: false, value: undefined };
  } else if (!envBefore.captured) {
    envBefore = { captured: true, value: process.env.OLLAMA_ENDPOINT };
  }
  installed = store;
  applyOllamaEndpoint();
}

/** The installed store, or null. */
export const installedOllamaEndpointStore = (): OllamaEndpointStore | null => installed;

/**
 * Make the saved endpoint the one the framework resolves: sets `OLLAMA_ENDPOINT` (the highest
 * env rung of `resolveOllamaEndpoint`), or restores what the server started with when no
 * endpoint is saved. Idempotent. See the module note for why this is process-wide.
 */
export function applyOllamaEndpoint(): void {
  if (!installed) return;
  const saved = installed.get();
  if (saved) process.env.OLLAMA_ENDPOINT = saved;
  else restoreEnv();
}

/** The endpoint agents, the model list and probes talk to: the saved one, else the framework's resolution. */
export const effectiveOllamaEndpoint = (): string => resolveOllamaEndpoint(installed?.get());

/** True when a saved Ollama key should be sent to `endpoint` (any non-loopback host). */
export const ollamaKeyApplies = (endpoint: string): boolean => !isLoopbackEndpoint(endpoint);

/** True when both URLs share an origin. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * The key to send to `endpoint` when listing models, or undefined. Only the host Cortex is
 * configured to use (`effectiveOllamaEndpoint`) ever gets it, so an `?endpoint=` the caller
 * typed cannot collect it. A saved key wins; else `OLLAMA_API_KEY` from the environment.
 */
export function ollamaListKey(endpoint: string, saved: string | undefined): string | undefined {
  if (!ollamaKeyApplies(endpoint) || !sameOrigin(endpoint, effectiveOllamaEndpoint())) return undefined;
  const env = process.env.OLLAMA_API_KEY?.trim();
  return saved ?? (env ? env : undefined);
}

/**
 * `fetch` that adds `Authorization: Bearer <key>` to requests for `endpoint`'s origin only;
 * requests to any other origin pass through untouched.
 */
export function bearerFetch(endpoint: string, key: string, base: typeof fetch = fetch): typeof fetch {
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    return base;
  }
  return Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let same = false;
      try {
        same = new URL(url).origin === origin;
      } catch {
        same = false;
      }
      if (!same) return base(input, init);
      const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
      headers.set("Authorization", `Bearer ${key}`);
      return base(input, { ...init, headers });
    },
    { preconnect: base.preconnect },
  );
}

/** True when an error line reads as an Ollama authentication failure (401 / unauthorized). */
export function isOllamaAuthFailure(message: string): boolean {
  return /ollama/i.test(message) && /\b401\b|unauthori[sz]ed|authentication|invalid api key/i.test(message);
}

/** The honest line for a rejected Ollama credential. */
export const OLLAMA_AUTH_MESSAGE = "Ollama Cloud key missing or invalid. Add or replace it in Settings · Providers.";
