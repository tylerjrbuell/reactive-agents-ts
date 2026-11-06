import type { InputModality } from "../capabilities.js";
import type { CacheControl, ContentBlock, ImageSource, LLMMessage } from "../types.js";
import { routeImage, type ContentPolicy, type DegradedPart, type ImageWireRules } from "../content-parts.js";

// Anthropic Messages API conversion (moved out of anthropic.ts, Plan 9 Phase 4
// stage E provider side).

/** Input modalities of the Anthropic Messages wire format. */
export const ANTHROPIC_INPUT_MODALITIES: readonly InputModality[] = ["text", "image"];

/**
 * Images ride `image` blocks on user turns and inside `tool_result` content.
 * The SDK in use (`@anthropic-ai/sdk` 0.30) types the image source as base64
 * only, so URL sources become stubs; so do images on assistant turns.
 */
export const ANTHROPIC_IMAGE_RULES: ImageWireRules = { url: false, roles: ["user", "tool"] };

type AnthropicRole = "user" | "assistant";

type AnthropicTextBlock = { type: "text"; text: string; cache_control?: CacheControl };
type AnthropicImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: ImageSource["media_type"]; data: string };
};

/** One Anthropic wire content block (the subset this adapter sends). */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | Array<AnthropicTextBlock | AnthropicImageBlock> };

/** One Anthropic wire message. */
export type AnthropicMessage = {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
};

/**
 * Convert messages to Anthropic wire messages (system messages are skipped:
 * they go through the top-level `system` field). Image blocks map to base64
 * `image` blocks or a degradation stub in place; text, tool_use and
 * tool_result blocks pass through unchanged, so text-only requests keep their
 * exact wire shape.
 *
 * @param messages — provider-neutral messages
 * @param policy — the per-request content policy
 * @returns wire messages plus the degradations to emit
 */
export const toAnthropicMessages = (
  messages: readonly LLMMessage[],
  policy: ContentPolicy,
): { readonly messages: AnthropicMessage[]; readonly degraded: readonly DegradedPart[] } => {
  const degraded: DegradedPart[] = [];
  const image = (
    block: Extract<ContentBlock, { readonly type: "image" }>,
    role: LLMMessage["role"],
  ): AnthropicTextBlock | AnthropicImageBlock => {
    const route = routeImage(block.source, role, policy, ANTHROPIC_IMAGE_RULES);
    if (route.kind === "stub") {
      degraded.push(route.degraded);
      return { type: "text", text: route.text };
    }
    // ANTHROPIC_IMAGE_RULES.url is false, so a sent source is always base64.
    return { type: "image", source: { type: "base64", media_type: route.source.media_type, data: route.source.data } };
  };

  const out = messages.flatMap((m): AnthropicMessage[] => {
    if (m.role === "system") return [];
    if (m.role === "tool") {
      const content =
        typeof m.content === "string"
          ? m.content
          : m.content.map((b) => (b.type === "image" ? image(b, "tool") : b));
      return [{ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content }] }];
    }
    if (typeof m.content === "string") return [{ role: m.role, content: m.content }];
    const role = m.role;
    return [{ role, content: m.content.map((b): AnthropicContentBlock => (b.type === "image" ? image(b, role) : b)) }];
  });
  return { messages: out, degraded };
};
