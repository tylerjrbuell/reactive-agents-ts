import { CORTEX_SERVER_URL } from "$lib/constants.js";

/** One selectable LLM provider (mirrors server `GET /api/models/providers`). */
export interface ProviderOption {
  readonly id: string;
  readonly label: string;
  readonly local: boolean;
}

/**
 * Static copy of the framework provider list, used until/unless the server answers.
 * Pinned against the server list in `providers.test.ts` so it cannot silently drift.
 */
export const PROVIDER_FALLBACK: readonly ProviderOption[] = [
  { id: "anthropic", label: "Anthropic", local: false },
  { id: "openai", label: "OpenAI", local: false },
  { id: "ollama", label: "Ollama (local)", local: true },
  { id: "gemini", label: "Google Gemini", local: false },
  { id: "litellm", label: "LiteLLM", local: true },
  { id: "groq", label: "Groq", local: false },
  { id: "xai", label: "xAI", local: false },
  { id: "test", label: "Test (deterministic)", local: true },
];

let cached: Promise<readonly ProviderOption[]> | null = null;

/** Clear the cached provider list (tests). */
export function resetProvidersCache(): void {
  cached = null;
}

/**
 * Load the provider list from the Cortex server (derived from the framework), cached per page load.
 * Falls back to {@link PROVIDER_FALLBACK} when the server is unreachable or answers badly,
 * so a picker is never empty.
 */
export function loadProviders(fetchImpl: typeof fetch = fetch): Promise<readonly ProviderOption[]> {
  if (cached) return cached;
  const attempt = (async (): Promise<readonly ProviderOption[]> => {
    try {
      const res = await fetchImpl(`${CORTEX_SERVER_URL}/api/models/providers`);
      if (!res.ok) return PROVIDER_FALLBACK;
      const body = (await res.json()) as { providers?: readonly ProviderOption[] };
      return body.providers && body.providers.length > 0 ? body.providers : PROVIDER_FALLBACK;
    } catch {
      return PROVIDER_FALLBACK;
    }
  })();
  cached = attempt;
  return attempt;
}
