import type { InputModality } from "../capabilities.js";
import type { ContentBlock, LLMMessage } from "../types.js";
import {
  IMAGES_ALLOWED,
  joinText,
  resolveParts,
  type ContentPolicy,
  type DegradedPart,
  type ImageWireRules,
  type ResolvedPart,
} from "../content-parts.js";

// OpenAI Chat Completions message conversion (moved out of openai.ts, Plan 9
// Phase 4 stage C). Also used for the user-content half of LiteLLM, which
// speaks the same wire format.

/** Input modalities of the OpenAI-compatible Chat Completions wire format. */
export const OPENAI_INPUT_MODALITIES: readonly InputModality[] = ["text", "image"];

/** Images ride `image_url` parts on user messages; URLs and data URLs both work. */
export const OPENAI_IMAGE_RULES: ImageWireRules = { url: true, roles: ["user"] };

type OpenAIToolCallParam = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** One part of a multimodal OpenAI user message. */
export type OpenAIUserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAIMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAIUserPart[] }
  | { role: "assistant"; content: string; tool_calls?: OpenAIToolCallParam[] }
  | { role: "tool"; tool_call_id: string; content: string };

/**
 * Wire content for routed user parts: a plain string when no image survived
 * routing (byte-identical to the text-only path), otherwise ordered parts.
 *
 * @param parts — routed parts of one user message
 */
export const toOpenAIUserContent = (parts: readonly ResolvedPart[]): string | OpenAIUserPart[] =>
  parts.some((p) => p.kind === "image")
    ? parts.map((p): OpenAIUserPart =>
        p.kind === "text"
          ? { type: "text", text: p.text }
          : {
              type: "image_url",
              image_url: {
                url: p.source.type === "url" ? p.source.data : `data:${p.source.media_type};base64,${p.source.data}`,
              },
            },
      )
    : joinText(parts);

/**
 * Convert messages to OpenAI wire messages, routing every image part to an
 * `image_url` part or a degradation stub.
 *
 * @param messages — provider-neutral messages
 * @param policy — the per-request content policy
 * @returns wire messages plus the degradations to emit
 */
export const mapOpenAIMessages = (
  messages: readonly LLMMessage[],
  policy: ContentPolicy,
): { readonly messages: OpenAIMessage[]; readonly degraded: readonly DegradedPart[] } => {
  const degraded: DegradedPart[] = [];
  const route = (blocks: readonly ContentBlock[], role: LLMMessage["role"]) => {
    const r = resolveParts(blocks, role, policy, OPENAI_IMAGE_RULES);
    degraded.push(...r.degraded);
    return r.parts;
  };
  const out = messages.map((m): OpenAIMessage => {
    if (m.role === "tool") {
      return {
        role: "tool" as const,
        tool_call_id: m.toolCallId,
        content: typeof m.content === "string" ? m.content : joinText(route(m.content, "tool")),
      };
    }

    if (m.role === "system") return { role: "system" as const, content: m.content };

    if (m.role === "user") {
      return {
        role: "user" as const,
        content: typeof m.content === "string" ? m.content : toOpenAIUserContent(route(m.content, "user")),
      };
    }

    if (typeof m.content !== "string") {
      const blocks = m.content;
      const textParts = joinText(route(blocks, "assistant"));
      const toolUseBlocks = blocks.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );

      if (toolUseBlocks.length > 0) {
        return {
          role: "assistant" as const,
          content: textParts || "",
          tool_calls: toolUseBlocks.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input),
            },
          })),
        };
      }

      return { role: "assistant" as const, content: textParts };
    }

    return { role: "assistant" as const, content: m.content };
  });
  return { messages: out, degraded };
};

/**
 * Convert messages to OpenAI wire messages (images admitted).
 *
 * @internal Exported for testing only
 */
export const toOpenAIMessages = (messages: readonly LLMMessage[]): OpenAIMessage[] =>
  mapOpenAIMessages(messages, IMAGES_ALLOWED).messages;
