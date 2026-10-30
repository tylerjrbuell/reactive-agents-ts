// packages/llm-provider/src/providers/chat-tools-rules.ts
//
// Observable side of the Chat Completions tool rules (see
// ../capability-chat-tools.ts): a once-per-model warning when reasoning is
// forced off, and the fail-fast error for Responses-only models. Shared by the
// OpenAI and LiteLLM adapters.

import { LLMError } from "../errors.js";
import type { LLMProvider } from "../types.js";

/**
 * One-shot warning tracker for the Chat Completions tool rule, keyed by
 * `provider/model` (same pattern as `thinking/resolve.ts`).
 */
const warnedToolReasoningDisabled = new Set<string>();

/**
 * Warn once when a configured reasoning budget was overridden to "none"
 * because the model only accepts function tools that way. Mirrors the
 * once-per-model console warnings already used for thinking degradation.
 * @internal
 */
export const warnChatToolsReasoningDisabledOnce = (
  provider: string,
  model: string,
): void => {
  const key = `${provider}/${model}`;
  if (warnedToolReasoningDisabled.has(key)) return;
  warnedToolReasoningDisabled.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[reasoning] ${key}: reasoning is disabled for tool calls on Chat Completions ` +
      `(the model only accepts function tools with reasoning_effort "none"). ` +
      `Use the Responses API (/v1/responses) to keep reasoning while calling tools.`,
  );
};

/**
 * Fail-fast error for models whose function tools are accepted only by the
 * Responses API. Raised BEFORE the network call so the user gets an actionable
 * message instead of the provider's raw 400.
 * @internal
 */
export const chatToolsRequireResponsesError = (
  provider: LLMProvider,
  model: string,
): LLMError =>
  new LLMError({
    provider,
    message:
      `${provider}: "${model}" does not accept function tools on Chat Completions ` +
      `(/v1/chat/completions). Its function tools are only available through the ` +
      `Responses API (/v1/responses). Choose a model that supports tools on Chat ` +
      `Completions (for example gpt-6-sol, which works with reasoning_effort "none"), ` +
      `or run without tools.`,
  });
