// packages/llm-provider/src/capability-chat-tools.ts
//
// Named-model tables for OpenAI Chat Completions tool-call restrictions. Kept
// out of capability.ts (size ceiling); re-exported from index.ts. Rows are
// documented facts, never inferred from id patterns: add one ONLY with a doc
// citation and a fetch date.

/**
 * Model id with any provider/vendor prefix removed (`openai/gpt-6-sol` ->
 * `gpt-6-sol`). LiteLLM routes carry a `<vendor>/` prefix on the wire, so the
 * family rules must match the id's own segment, not the prefix.
 */
const lastIdSegment = (model: string): string =>
  model.slice(model.lastIndexOf("/") + 1).toLowerCase();

/** `id` is `name` itself or a dated/suffixed variant (`name-2026-08-01`). */
const isNameOrVariant = (id: string, name: string): boolean =>
  id === name || id.startsWith(`${name}-`);

/**
 * Named-model table: function tools on Chat Completions work ONLY with
 * `reasoning_effort: "none"`.
 *
 * Source (fetched 2026-10-29): https://developers.openai.com/api/docs/guides/latest-model
 * "GPT-6 Sol and GPT-6 Luna support function calling in Chat Completions only
 * with reasoning_effort: \"none\"." Add a row ONLY with a doc citation.
 */
export const CHAT_TOOLS_REQUIRE_NO_REASONING: readonly string[] = ["gpt-6-sol", "gpt-6-luna"];

/**
 * Named-model table: function tools are accepted ONLY by the Responses API
 * (`/v1/responses`), never by Chat Completions.
 *
 * Source (fetched 2026-10-29): https://developers.openai.com/api/docs/guides/latest-model
 * "GPT-6 Astra, GPT-6.1 Sol, and GPT-6.1 Terra support Chat Completions, but
 * tool calling requires Responses." Add a row ONLY with a doc citation.
 */
export const CHAT_TOOLS_REQUIRE_RESPONSES: readonly string[] = [
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
];

/** True when `model` is in {@link CHAT_TOOLS_REQUIRE_NO_REASONING} (or a dated variant). */
export const chatToolsRequireNoReasoning = (model: string): boolean => {
  const id = lastIdSegment(model);
  return CHAT_TOOLS_REQUIRE_NO_REASONING.some((name) => isNameOrVariant(id, name));
};

/** True when `model` is in {@link CHAT_TOOLS_REQUIRE_RESPONSES} (or a dated variant). */
export const chatToolsRequireResponses = (model: string): boolean => {
  const id = lastIdSegment(model);
  return CHAT_TOOLS_REQUIRE_RESPONSES.some((name) => isNameOrVariant(id, name));
};
