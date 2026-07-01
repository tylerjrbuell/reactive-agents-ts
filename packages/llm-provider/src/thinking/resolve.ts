/**
 * Unified thinking resolution — one tri-state contract for every provider.
 *
 * Control-pillar discipline (mirrors local.ts FIX-3): `undefined` NEVER
 * auto-enables. Only explicit `true` (or a future per-request override) turns
 * thinking on, and only when the model is actually capable.
 */
export interface ThinkingOptions {
  /** Tri-state mirror of config.thinking. */
  readonly enabled?: boolean;
  /** OpenAI reasoning_effort; advisory for other providers. */
  readonly effort?: "low" | "medium" | "high";
  /** Explicit thinking budget in tokens; overrides the scaled default (still clamped). */
  readonly budgetTokens?: number;
}

const warned = new Set<string>();

/**
 * Resolve whether thinking should be enabled for this call.
 * @param requestOverride unbuilt per-request seam; when set it takes precedence
 *   over `configThinking`. Always `undefined` today.
 */
export const resolveThinkingEnabled = (
  provider: string,
  model: string,
  configThinking: boolean | undefined,
  supportsThinkingMode: boolean,
  requestOverride?: boolean,
): boolean => {
  const want = requestOverride ?? configThinking;
  if (want !== true) return false; // undefined/false → off (opt-in)
  if (!supportsThinkingMode) {
    const key = `${provider}/${model}`;
    if (!warned.has(key)) {
      warned.add(key);
      // eslint-disable-next-line no-console
      console.warn(
        `[thinking] ${key} does not support thinking mode; ignoring thinking:true (degrading to off).`,
      );
    }
    return false;
  }
  return true;
};
