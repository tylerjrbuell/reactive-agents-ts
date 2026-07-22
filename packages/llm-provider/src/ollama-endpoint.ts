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
