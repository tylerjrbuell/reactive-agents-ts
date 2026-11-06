/**
 * Cloud wire mapping for `CompletionRequest.toolChoice` (see `ToolChoice` in
 * `../tool-protocol.ts`). Each helper returns the extra body fields for a
 * forced call and an empty object otherwise, so a request with `toolChoice`
 * omitted or `"auto"` keeps its exact wire shape. Ollama's mapping is
 * constrained decoding and lives in `./ollama-tools.ts`.
 */
import { isToolCallRequired, type ToolChoice, type ToolDefinition } from "../tool-protocol.js";

/** The request fields every tool-choice mapping reads. */
export type ToolChoiceRequest = {
  readonly toolChoice?: ToolChoice;
  readonly tools?: readonly ToolDefinition[];
  readonly thinking?: boolean;
};

/** Anthropic: `tool_choice: { type: "any" }` when a call is required. */
export const anthropicToolChoiceField = (
  request: ToolChoiceRequest,
): { readonly tool_choice?: { readonly type: "any" } } =>
  isToolCallRequired(request) ? { tool_choice: { type: "any" } } : {};

/**
 * Anthropic per-call thinking preference. Anthropic rejects a forced
 * `tool_choice` together with extended thinking, so a required call turns
 * thinking off; otherwise the request's own preference passes through.
 */
export const anthropicThinkingPreference = (
  request: ToolChoiceRequest,
): boolean | undefined => (isToolCallRequired(request) ? false : request.thinking);

/** OpenAI, OpenAI-compatible and LiteLLM: `tool_choice: "required"`. */
export const openAIToolChoiceField = (
  request: ToolChoiceRequest,
): { readonly tool_choice?: "required" } =>
  isToolCallRequired(request) ? { tool_choice: "required" } : {};

/** Gemini: `toolConfig.functionCallingConfig.mode = "ANY"` (generation config field). */
export const geminiToolConfigField = (
  request: ToolChoiceRequest,
): { readonly toolConfig?: { readonly functionCallingConfig: { readonly mode: "ANY" } } } =>
  isToolCallRequired(request) ? { toolConfig: { functionCallingConfig: { mode: "ANY" } } } : {};
