// packages/llm-provider/src/ollama-endpoint.ts
//
// Single resolution point for "which Ollama am I talking to".
//
// The framework used to read `OLLAMA_ENDPOINT` at four independent sites (the
// provider base URL, the capability probe, the build-time connection check, the
// calibration runner's `OLLAMA_BASE`). Ollama's own CLI and docs use
// `OLLAMA_HOST`, so an app that set the canonical name was silently ignored and
// every one of those sites quietly fell back to localhost — which, inside a
// container, is nothing at all. The visible symptom was never "wrong endpoint":
// the capability probe failed, the conservative 2048-ctx / dialect-"none"
// fallback took over, and `.withStrictValidation()` failed the build with a
// message about the MODEL (2026-07-22, found dogfooding FORGE, whose Docker
// config sets `OLLAMA_HOST: http://host.docker.internal:11434`).
//
// Resolution order (first non-blank wins):
//   1. an explicit argument (config value the caller already resolved)
//   2. `OLLAMA_ENDPOINT` — the framework's historical name, so existing configs
//      keep their precedence
//   3. `OLLAMA_HOST` — what Ollama itself documents
//   4. `OLLAMA_BASE` — the calibration runner's original name
//   5. `http://localhost:11434`

import { OllamaAuthError } from "./errors.js";

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";

function firstNonBlank(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * Resolve the Ollama base URL, normalising the two shapes users actually write.
 *
 * `OLLAMA_HOST=127.0.0.1:11434` (no scheme) is the form Ollama's own docs use
 * for `ollama serve`, so a bare host:port gets `http://` prepended rather than
 * producing an unusable URL. A trailing slash is trimmed so callers can append
 * `/api/show` without doubling it.
 */
export function resolveOllamaEndpoint(explicit?: string): string {
  const raw =
    firstNonBlank(
      explicit,
      process.env.OLLAMA_ENDPOINT,
      process.env.OLLAMA_HOST,
      process.env.OLLAMA_BASE,
    ) ?? DEFAULT_OLLAMA_ENDPOINT;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** Where an Ollama call goes and how it authenticates. */
export interface OllamaTarget {
  /** Resolved base URL (no trailing slash). */
  readonly endpoint: string;
  /** Bearer key: explicit value, else `OLLAMA_API_KEY`; absent for local Ollama. */
  readonly apiKey: string | undefined;
  /** Request headers carrying the key. Empty when there is no key. */
  readonly headers: Readonly<Record<string, string>>;
  /** Set when a key was withheld or would travel in cleartext. Never contains a secret. */
  readonly warning?: string;
}

const OLLAMA_CLOUD_ORIGIN = "https://ollama.com";

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Env/ambient keys may only go to https endpoints (or the Ollama Cloud origin), never loopback. */
function ambientKeyAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (isLoopbackHost(url.hostname)) return false;
  return url.protocol === "https:" || url.origin === OLLAMA_CLOUD_ORIGIN;
}

/**
 * Resolve `{ endpoint, apiKey, headers }` for one Ollama call site.
 *
 * Endpoint: `resolveOllamaEndpoint` (explicit `baseUrl` first, then env).
 * Key: explicit `apiKey` (`.withProvider("ollama", { apiKey })`) is always
 * honoured (caller intent). The ambient key (`ambientApiKey`, else
 * `OLLAMA_API_KEY`) is attached only when the endpoint is https (or exactly
 * `https://ollama.com`) and not loopback; otherwise it is withheld and
 * `warning` says so. Ollama Cloud rejects unauthenticated requests, so every
 * call (pre-flight, /api/show, /api/tags, /api/chat) must use this one
 * result. The key is only ever attached to the resolved endpoint.
 */
export function resolveOllamaTarget(
  opts: { readonly baseUrl?: string; readonly apiKey?: string; readonly ambientApiKey?: string } = {},
): OllamaTarget {
  const endpoint = resolveOllamaEndpoint(opts.baseUrl);
  const explicit = firstNonBlank(opts.apiKey);
  const ambient = firstNonBlank(opts.ambientApiKey, process.env.OLLAMA_API_KEY);
  let apiKey = explicit;
  let warning: string | undefined;
  if (explicit !== undefined) {
    if (endpoint.startsWith("http://") && !isLoopbackHost(new URL(endpoint).hostname)) {
      warning = `Ollama API key is sent over cleartext http to ${endpoint}. Use https.`;
    }
  } else if (ambient !== undefined) {
    if (ambientKeyAllowed(endpoint)) {
      apiKey = ambient;
    } else if (endpoint.startsWith("http://") && !isLoopbackHost(new URL(endpoint).hostname)) {
      warning = `OLLAMA_API_KEY not sent to cleartext http endpoint ${endpoint}. Use https, or pass apiKey explicitly to .withProvider("ollama", { apiKey }).`;
    }
  }
  return {
    endpoint,
    apiKey,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    ...(warning !== undefined ? { warning } : {}),
  };
}

/** Outcome of {@link checkOllamaConnection}. `message` never contains the key. */
export type OllamaConnectionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly error?: OllamaAuthError };

/**
 * Pre-flight reachability + auth check (`GET {endpoint}/api/tags`, 3s bound).
 * Sends the Bearer key from {@link resolveOllamaTarget}. 401/403 yields a typed
 * {@link OllamaAuthError} (with `status`) alongside the message.
 */
export async function checkOllamaConnection(
  opts: { readonly baseUrl?: string; readonly apiKey?: string } = {},
): Promise<OllamaConnectionCheck> {
  const { endpoint, headers, apiKey } = resolveOllamaTarget(opts);
  try {
    const res = await fetch(`${endpoint}/api/tags`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) {
      const error = new OllamaAuthError({
        message: apiKey
          ? `Ollama at ${endpoint} rejected the API key (HTTP ${res.status}).`
          : `Ollama at ${endpoint} requires an API key (HTTP ${res.status}). Set OLLAMA_API_KEY or pass apiKey to .withProvider("ollama", { apiKey }).`,
        status: res.status,
        endpoint,
        keyProvided: apiKey !== undefined,
      });
      return { ok: false, message: error.message, error };
    }
    return { ok: false, message: `Ollama returned HTTP ${res.status}. Is the service running at ${endpoint}?` };
  } catch {
    return {
      ok: false,
      message: `Cannot connect to Ollama at ${endpoint}. Is the Ollama service running?\n  Start it with: ollama serve`,
    };
  }
}
