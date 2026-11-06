/**
 * to-llm-messages.ts — provider-boundary glue.
 *
 * Converts the structural `ProviderRequest.messages` produced by `project()`
 * into the provider-native `LLMMessage[]` the LLM service consumes. It is the
 * one kernel-to-provider message conversion (the kernel-side mirror
 * `toProviderMessage` was deleted 2026-11-06, no live caller), so typed
 * content parts (Plan 9 Phase 4) map to provider ContentBlocks here only.
 *
 * Pure. No `any`: tool-call entries are narrowed with a guard.
 *
 * Content parts (Plan 9 Phase 4 stage D1): string content passes through
 * unchanged (text-only content is canonically one string, so text runs keep
 * their exact bytes). Part arrays map to ContentBlocks: text and supported
 * images become blocks; audio, file and unsupported-image parts become a
 * deterministic text stub, because the provider ContentBlock has no audio/file
 * shape yet (provider stage C adds per-provider mapping and the
 * `content-part-degraded` fact). Tool-result content stays one string when it
 * is text only and goes as text/image blocks otherwise (provider stage E maps
 * tool-result images per provider). `degradedParts` lists every
 * stub this conversion makes; think.ts records each as a
 * `content-part-degraded` trace fact (stage F).
 */
import type { LLMMessage, ContentBlock, ImageSource, ToolMessageBlock } from "@reactive-agents/llm-provider";
import {
  contentText,
  mediaPartLabel,
  summarizePart,
  type ContentPart,
  type ContentPartSummary,
  type MessageContent,
} from "@reactive-agents/core";
import { sanitizeToolName } from "../kernel/capabilities/attend/context-utils.js";
import type { ProviderRequest } from "./types.js";

const PROVIDER_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function isProviderImageType(mediaType: string): mediaType is ImageSource["media_type"] {
  return PROVIDER_IMAGE_TYPES.has(mediaType);
}

const NO_PROVIDER_INPUT = "no provider input for this part yet";

/**
 * Why this conversion stubs a non-text part, or undefined when the part maps
 * to a block. The one rule both the mapping and {@link degradedParts} read, so
 * the recorded facts can never disagree with what the provider received. Same
 * rule for every role: tool results carry image blocks too (provider stage E).
 */
function stubReason(part: Exclude<ContentPart, { type: "text" }>): string | undefined {
  if (part.type === "image") return isProviderImageType(part.source.media_type) ? undefined : "unsupported image type";
  return NO_PROVIDER_INPUT;
}

function partToBlock(part: ContentPart): ToolMessageBlock {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image") {
    const { media_type } = part.source;
    if (isProviderImageType(media_type)) {
      return { type: "image", source: { type: part.source.type, media_type, data: part.source.data } };
    }
  }
  // The deterministic text stand-in for a part the provider wire cannot carry.
  return { type: "text", text: mediaPartLabel(part, stubReason(part) ?? NO_PROVIDER_INPUT) };
}

function toBlocks(content: MessageContent): string | readonly ContentBlock[] {
  return typeof content === "string" ? content : content.map(partToBlock);
}

/**
 * Tool-role wire content: text-only content stays one string (text parts join
 * with "", the contentText rule), so text runs keep their exact bytes; content
 * with any non-text part goes as text/image blocks, which each provider maps
 * (native tool-result image, or relocated to a follow-up user turn).
 */
function toToolContent(content: MessageContent): string | readonly ToolMessageBlock[] {
  return typeof content === "string" || content.every((p) => p.type === "text")
    ? contentText(content)
    : content.map(partToBlock);
}

/** One part {@link toLLMMessages} replaced with a text stub. Summary only, never bytes. */
export interface DegradedKernelPart {
  readonly part: ContentPartSummary;
  readonly role: "user" | "assistant" | "tool";
  readonly reason: string;
}

/**
 * The parts {@link toLLMMessages} stubs for these messages (Plan 9 Phase 4
 * stage F): audio and file parts and unsupported image types, in any role.
 * The caller records each as a `content-part-degraded` trace fact. Empty for
 * text-only messages.
 */
export function degradedParts(messages: ProviderRequest["messages"]): readonly DegradedKernelPart[] {
  const out: DegradedKernelPart[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    const role = m.role === "tool_result" ? "tool" : m.role === "assistant" ? "assistant" : "user";
    for (const p of m.content) {
      if (p.type === "text") continue;
      const reason = stubReason(p);
      if (reason !== undefined) out.push({ part: summarizePart(p), role, reason });
    }
  }
  return out;
}

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

function isToolCallArray(v: unknown): v is readonly ToolCall[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) =>
        x !== null &&
        typeof x === "object" &&
        "id" in x &&
        typeof (x as { id: unknown }).id === "string" &&
        "name" in x &&
        typeof (x as { name: unknown }).name === "string",
    )
  );
}

export function toLLMMessages(messages: ProviderRequest["messages"]): LLMMessage[] {
  return messages.map((m): LLMMessage => {
    if (m.role === "assistant") {
      if (isToolCallArray(m.toolCalls) && m.toolCalls.length > 0) {
        const lead: readonly ContentBlock[] =
          typeof m.content === "string"
            ? m.content
              ? [{ type: "text", text: m.content }]
              : []
            : m.content.map(partToBlock);
        const blocks: ContentBlock[] = [
          ...lead,
          // Sanitize on replay: names are stored canonically (e.g. MCP
          // `github/list_commits`) but the provider payload requires
          // `^[a-zA-Z0-9_-]+$` — mirror the outbound tools-array sanitization.
          ...m.toolCalls.map(
            (tc): ContentBlock => ({ type: "tool_use", id: tc.id, name: sanitizeToolName(tc.name), input: tc.arguments }),
          ),
        ];
        return { role: "assistant", content: blocks };
      }
      return { role: "assistant", content: toBlocks(m.content) };
    }
    if (m.role === "tool_result") {
      return {
        role: "tool",
        toolCallId: m.toolCallId ?? "",
        ...(m.toolName !== undefined ? { toolName: sanitizeToolName(m.toolName) } : {}),
        content: toToolContent(m.content),
      };
    }
    // user (and any other role falls back to a user turn — provider-safe)
    return { role: "user", content: toBlocks(m.content) };
  });
}
