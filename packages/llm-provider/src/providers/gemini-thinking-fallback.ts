// packages/llm-provider/src/providers/gemini-thinking-fallback.ts
//
// Safety net for Gemini API models that reject `thinkingConfig`.
// `buildGenerationConfig` sends the field only when the resolved capability
// says the model supports thinking. A model the capability table gets wrong
// (a new Gemma id, an image model whose listing claims thinking) still gets a
// 400 such as "Thinking budget is not supported for this model." This module
// retries that request ONCE without `thinkingConfig`, warns, and remembers the
// model so later requests on the same provider instance skip the field.

/** Generation config as built by `buildGenerationConfig`. */
export type GeminiGenerationConfig = Record<string, unknown>;

/** What the provider records when it retried without `thinkingConfig`. */
export interface ThinkingConfigRetry {
  readonly provider: "gemini";
  readonly model: string;
  /** The provider's rejection message that triggered the retry. */
  readonly reason: string;
}

/**
 * Per-provider-instance fallback state. Create one per `GeminiProviderLive`
 * build (no module-level run state).
 */
export interface ThinkingConfigFallback {
  /**
   * Call `send` with `cfg`. When the API rejects the thinking field and `cfg`
   * carries one, report the retry and call `send` once more without it.
   * Models that rejected the field before are sent without it up front.
   */
  readonly run: <A>(
    model: string,
    cfg: GeminiGenerationConfig,
    send: (cfg: GeminiGenerationConfig) => Promise<A>,
  ) => Promise<A>;
}

const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
};

/**
 * True when a Gemini rejection says the model does not accept the thinking
 * field ("Thinking budget is not supported for this model.", "thinking_config
 * is not supported", ...). Narrow on purpose: other 400s are not retried.
 *
 * @param error — the value the SDK call rejected with
 */
export const isThinkingConfigRejection = (error: unknown): boolean =>
  /thinking[ _]?(?:budget|config|level)?[^.]{0,40}\bnot\s+(?:supported|enabled)/i.test(messageOf(error));

const withoutThinking = (cfg: GeminiGenerationConfig): GeminiGenerationConfig => {
  const { thinkingConfig: _dropped, ...rest } = cfg;
  return rest;
};

/**
 * Build the fallback for one provider instance.
 *
 * @param onRetry — called once per retried request; the provider warns here
 */
export const makeThinkingConfigFallback = (
  onRetry: (retry: ThinkingConfigRetry) => void,
): ThinkingConfigFallback => {
  const rejected = new Set<string>();
  return {
    run: async (model, cfg, send) => {
      if (cfg.thinkingConfig === undefined) return send(cfg);
      if (rejected.has(model)) return send(withoutThinking(cfg));
      try {
        return await send(cfg);
      } catch (error) {
        if (!isThinkingConfigRejection(error)) throw error;
        rejected.add(model);
        onRetry({ provider: "gemini", model, reason: messageOf(error) });
        return send(withoutThinking(cfg));
      }
    },
  };
};

const warned = new Set<string>();

/**
 * Default `onRetry` for the Gemini provider: one console warning per model,
 * the same once-per-model pattern as the other thinking degradations.
 * @internal
 */
export const warnThinkingConfigRetryOnce = (retry: ThinkingConfigRetry): void => {
  const key = `${retry.provider}/${retry.model}`;
  if (warned.has(key)) return;
  warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[reactive-agents] ${key} rejected thinkingConfig (${retry.reason}); ` +
      `retried without it. Thinking control is off for this model.`,
  );
};
