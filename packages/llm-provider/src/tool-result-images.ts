import { base64DecodedBytes } from "@reactive-agents/core";
import type { ContentBlock, LLMMessage, ToolMessageBlock } from "./types.js";
import {
  routeImage,
  type ContentPolicy,
  type DegradedPart,
  type ImageWireRules,
} from "./content-parts.js";

// Tool-result images on wires with no image slot in tool messages (Plan 9
// Phase 4 stage E, provider side).
//
// OpenAI Chat Completions (and LiteLLM, same wire) types tool message content
// as text only. Gemini's `functionResponse.parts` can carry inline media, but
// the API documents it for Gemini 3 models only, so it is not used here. These
// providers relocate a tool-result image to one user message placed right
// after the contiguous run of tool messages. The run must stay unbroken:
// OpenAI rejects any message between an assistant `tool_calls` turn and the
// tool messages answering it. The tool message keeps a text marker where the
// image was. Anthropic and Ollama carry tool images natively and do not use
// this.

const sizeText = (image: ToolMessageBlock & { readonly type: "image" }): string =>
  image.source.type === "base64"
    ? `${Math.max(1, Math.round(base64DecodedBytes(image.source.data) / 1024))} KB`
    : "remote url";

/**
 * Text left in a tool message where an image was relocated, e.g.
 * `[image: image/png, 41 KB; attached in the next user message]`.
 *
 * @param image — the relocated image block
 */
export const relocatedMarker = (image: ToolMessageBlock & { readonly type: "image" }): string =>
  `[image: ${image.source.media_type}, ${sizeText(image)}; attached in the next user message]`;

/**
 * Label that opens each tool's images in the follow-up user message, e.g.
 * `Image output of tool "screenshot" (call t1):`.
 *
 * @param toolName — the tool name, when known
 * @param toolCallId — the tool call id
 */
export const relocatedLabel = (toolName: string | undefined, toolCallId: string): string =>
  `Image output of tool "${toolName ?? "unknown_tool"}" (call ${toolCallId}):`;

/**
 * Relocate tool-result images to a follow-up user message for a provider
 * whose tool messages carry text only.
 *
 * An image is relocated when the provider's user slot would send it (request
 * policy, user-role wire slot, URL support). Otherwise it becomes its stub in
 * place, recorded with `role: "tool"` and the reason the user slot gave.
 * Messages without tool-result images are returned as the same array, so
 * text-only requests are byte-identical.
 *
 * @param messages — provider-neutral messages
 * @param policy — the per-request content policy
 * @param rules — the provider's image wire rules (its user slot is the target)
 * @returns messages with no image left in any tool message, plus degradations
 */
export const relocateToolImages = (
  messages: readonly LLMMessage[],
  policy: ContentPolicy,
  rules: ImageWireRules,
): { readonly messages: readonly LLMMessage[]; readonly degraded: readonly DegradedPart[] } => {
  const hasToolImage = messages.some(
    (m) => m.role === "tool" && typeof m.content !== "string" && m.content.some((b) => b.type === "image"),
  );
  if (!hasToolImage) return { messages, degraded: [] };

  const out: LLMMessage[] = [];
  const degraded: DegradedPart[] = [];
  let pending: ContentBlock[] = [];
  const flush = (): void => {
    if (pending.length > 0) out.push({ role: "user", content: pending });
    pending = [];
  };

  for (const m of messages) {
    if (m.role !== "tool") {
      flush();
      out.push(m);
      continue;
    }
    if (typeof m.content === "string" || !m.content.some((b) => b.type === "image")) {
      out.push(m);
      continue;
    }
    const moved: ContentBlock[] = [];
    const kept = m.content.map((b): ToolMessageBlock => {
      if (b.type !== "image") return b;
      const route = routeImage(b.source, "user", policy, rules);
      if (route.kind === "send") {
        moved.push(b);
        return { type: "text", text: relocatedMarker(b) };
      }
      degraded.push({ ...route.degraded, role: "tool" });
      return { type: "text", text: route.text };
    });
    out.push({ ...m, content: kept });
    if (moved.length > 0) pending.push({ type: "text", text: relocatedLabel(m.toolName, m.toolCallId) }, ...moved);
  }
  flush();
  return { messages: out, degraded };
};
