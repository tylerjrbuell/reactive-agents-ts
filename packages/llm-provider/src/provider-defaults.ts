/**
 * Default model constants for each LLM provider.
 * Single source of truth — used by providers at construction time
 * and by the runtime to resolve model names for display/metrics.
 */

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    ollama: 'llama3.2',
    gemini: 'gemini-2.5-flash',
    litellm: 'gpt-4o',
    test: 'test-model',
}

/**
 * Get the default model for a given provider.
 * Returns undefined if the provider is not recognized.
 */
export function getProviderDefaultModel(provider: string): string | undefined {
    return PROVIDER_DEFAULT_MODELS[provider]
}
