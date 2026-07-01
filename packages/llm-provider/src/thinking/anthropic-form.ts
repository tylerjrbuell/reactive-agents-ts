import type { ThinkingOptions } from "./resolve.js";

/**
 * Which extended-thinking request form a given Anthropic model requires.
 * - `"enabled"` — legacy `thinking:{type:"enabled",budget_tokens}` shape.
 *   Accepted only on Opus/Haiku/Sonnet 4.5 and earlier (Claude 3.x).
 * - `"adaptive"` — current `thinking:{type:"adaptive"}` + top-level
 *   `output_config:{effort}` shape. Required on 4.6+ (Opus 4.7/4.8, Sonnet 5,
 *   Fable, Mythos). Sending the legacy shape to these models returns 400.
 */
export type AnthropicThinkingForm = "adaptive" | "enabled";

export const anthropicThinkingForm = (model: string): AnthropicThinkingForm => {
  const m = model.toLowerCase();
  // Legacy budget_tokens form: Opus/Haiku/Sonnet 4.5 and earlier.
  if (/(opus-4-5|haiku-4-5|sonnet-4-5|claude-3)/.test(m)) return "enabled";
  // Everything newer (4.6, 4.7, 4.8, sonnet-5, fable, mythos, unknown-new) → adaptive.
  return "adaptive";
};

/**
 * Build the Anthropic thinking-related request-body fields.
 *
 * When thinking is off (`reserve === undefined`) the ONLY field returned is
 * `temperature` — byte-identical to the pre-thinking request. When thinking is
 * on, `temperature` is OMITTED entirely (the API rejects any value other than 1
 * while thinking/adaptive mode is active) and the correct form-specific shape is
 * returned:
 *   - adaptive → `thinking:{type:"adaptive"}` (+ `output_config:{effort}` when set)
 *   - enabled  → `thinking:{type:"enabled",budget_tokens:reserve}`
 *
 * `max_tokens` is computed by the caller (`answerBudget + reserve`) and is valid
 * for both forms, so it is not part of this helper.
 */
export const buildAnthropicThinkingBody = (
  model: string,
  reserve: number | undefined,
  effort: ThinkingOptions["effort"] | undefined,
  temperature: number,
): Record<string, unknown> => {
  if (reserve === undefined) return { temperature };
  if (anthropicThinkingForm(model) === "adaptive") {
    return {
      thinking: { type: "adaptive" as const },
      ...(effort ? { output_config: { effort } } : {}),
    };
  }
  return { thinking: { type: "enabled" as const, budget_tokens: reserve } };
};
