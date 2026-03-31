/**
 * Configuration for the FallbackChain graceful degradation strategy.
 *
 * Specifies ordered lists of fallback providers and models, along with
 * the error threshold that triggers switching to the next provider.
 *
 * @example
 * ```typescript
 * const config: FallbackConfig = {
 *   providers: ["anthropic", "openai", "gemini"],
 *   models: ["claude-sonnet-4-20250514", "claude-haiku-3-20250520"],
 *   errorThreshold: 3,
 * };
 * ```
 */
export interface FallbackConfig {
  /** Ordered list of provider names to try in sequence. */
  readonly providers: string[];
  /** Ordered list of model names to try within the same provider. */
  readonly models?: string[];
  /** Consecutive errors on a provider before switching to next. Default: 3 */
  readonly errorThreshold?: number;
}

/** Called when the chain switches to the next provider. */
export type FallbackCallback = (
  fromProvider: string,
  toProvider: string,
  reason: string,
  attemptNumber: number,
) => void;

/**
 * FallbackChain manages graceful degradation when LLM providers or models fail.
 *
 * Tracks consecutive errors per provider and automatically switches to the next
 * provider when the error threshold is exceeded. On rate limits (429), falls back
 * to a cheaper model within the same provider.
 *
 * Use case: Deploy with Anthropic as primary, OpenAI as secondary, Gemini as
 * fallback. If Claude API goes down, automatically route to GPT. If quota exceeded,
 * switch from claude-sonnet to claude-haiku to reduce cost/load.
 *
 * @example
 * ```typescript
 * const chain = new FallbackChain({
 *   providers: ["anthropic", "openai"],
 *   models: ["claude-sonnet-4-20250514", "claude-haiku-3-20250520"],
 *   errorThreshold: 3,
 * });
 *
 * // Record errors
 * chain.recordError("anthropic");
 * chain.recordError("anthropic");
 * chain.recordError("anthropic"); // threshold met, switch to openai
 *
 * console.log(chain.currentProvider()); // "openai"
 *
 * // Record rate limit, fall back to cheaper model
 * chain.recordRateLimit("openai");
 * console.log(chain.currentModel()); // "claude-haiku-3-20250520"
 *
 * // Successful call resets error count
 * chain.recordSuccess("openai");
 *
 * // Check if more fallbacks available
 * if (!chain.hasFallback()) {
 *   console.log("All providers exhausted!");
 * }
 * ```
 */
export class FallbackChain {
  /** Error count per provider. */
  private readonly errorCounts = new Map<string, number>();

  /** Current index in the providers list. */
  private currentProviderIndex = 0;

  /** Current index in the models list. */
  private currentModelIndex = 0;

  /** Threshold for switching to next provider. */
  private readonly threshold: number;

  constructor(
    private readonly config: FallbackConfig,
    private readonly onFallback?: FallbackCallback,
  ) {
    this.threshold = config.errorThreshold ?? 3;
  }

  /**
   * Record an error for the given provider.
   * Increments the error count and switches to the next provider if threshold is met.
   *
   * @param provider - Provider name that errored
   */
  recordError(provider: string): void {
    const count = (this.errorCounts.get(provider) ?? 0) + 1;
    this.errorCounts.set(provider, count);

    // Switch to next provider if threshold met and not at the end
    if (count >= this.threshold && this.currentProviderIndex < this.config.providers.length - 1) {
      const fromProvider = this.config.providers[this.currentProviderIndex] ?? provider;
      this.currentProviderIndex++;
      const toProvider = this.config.providers[this.currentProviderIndex] ?? "unknown";
      this.onFallback?.(fromProvider, toProvider, `error_threshold:${count}`, count);
    }
  }

  /**
   * Record a rate limit error (429) for the given provider.
   * Falls back to the next model in the chain.
   *
   * @param _provider - Provider name that was rate limited (parameter name _ to indicate unused)
   */
  recordRateLimit(_provider: string): void {
    // Fall back to the next model if available
    if (this.config.models && this.currentModelIndex < this.config.models.length - 1) {
      this.currentModelIndex++;
    }
  }

  /**
   * Record a successful call for the given provider.
   * Resets the error count for that provider.
   *
   * @param provider - Provider name that succeeded
   */
  recordSuccess(provider: string): void {
    this.errorCounts.set(provider, 0);
  }

  /**
   * Get the currently active provider.
   *
   * @returns Name of the provider to use
   */
  currentProvider(): string {
    const provider = this.config.providers[this.currentProviderIndex];
    if (!provider) {
      throw new Error(`FallbackChain: Invalid provider index ${this.currentProviderIndex}`);
    }
    return provider;
  }

  /**
   * Get the currently active model.
   * Returns undefined if no models are configured.
   *
   * @returns Name of the model to use, or undefined if no models configured
   */
  currentModel(): string | undefined {
    return this.config.models?.[this.currentModelIndex];
  }

  /**
   * Check if there are more fallbacks available (provider or model).
   *
   * @returns true if there are unused fallback providers or models, false if all exhausted
   */
  hasFallback(): boolean {
    const hasProviderFallback = this.currentProviderIndex < this.config.providers.length - 1;
    const hasModelFallback =
      this.config.models !== undefined && this.currentModelIndex < this.config.models.length - 1;

    return hasProviderFallback || hasModelFallback;
  }
}
