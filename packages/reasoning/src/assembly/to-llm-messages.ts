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
 * `content-part-degraded` fact). Provider tool-role content is a string, so
 * tool-result parts flatten to text plus stubs.
 */
import type { LLMMessage, ContentBlock, ImageSource } from "@reactive-agents/llm-provider";
import type { ContentPart, MessageContent } from "@reactive-agents/core";
import { sanitizeToolName } from "../kernel/capabilities/attend/context-utils.js";
import type { ProviderRequest } from "./types.js";

const PROVIDER_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function isProviderImageType(mediaType: string): mediaType is ImageSource["media_type"] {
  return PROVIDER_IMAGE_TYPES.has(mediaType);
}

/** Deterministic text stand-in for a part the provider wire cannot carry. */
function partStub(part: Exclude<ContentPart, { type: "text" }>, why: string): string {
  switch (part.type) {
    case "image":
      return `[image omitted: ${part.source.media_type}; ${why}]`;
    case "audio":
      return part.transcript !== undefined
        ? `[audio omitted: ${part.source.media_type}; transcript: ${part.transcript}]`
        : `[audio omitted: ${part.source.media_type}; ${why}]`;
    case "file":
      return `[file: ${part.ref.name ?? part.ref.uri} (${part.ref.media_type}) at ${part.ref.uri}]`;
  }
}

function partToBlock(part: ContentPart): ContentBlock {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image") {
    const { media_type } = part.source;
    if (isProviderImageType(media_type)) {
      return { type: "image", source: { type: part.source.type, media_type, data: part.source.data } };
    }
    return { type: "text", text: partStub(part, "unsupported image type") };
  }
  return { type: "text", text: partStub(part, "no provider input for this part yet") };
}

function toBlocks(content: MessageContent): string | readonly ContentBlock[] {
  return typeof content === "string" ? content : content.map(partToBlock);
}

/** Tool-role wire content is a string: text parts join with "" (contentText rule), others stub. */
function toToolText(content: MessageContent): string {
  return typeof content === "string"
    ? content
    : content.map((p) => (p.type === "text" ? p.text : partStub(p, "tool results carry text only"))).join("");
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
        content: toToolText(m.content),
      };
    }
    // user (and any other role falls back to a user turn — provider-safe)
    return { role: "user", content: toBlocks(m.content) };
  });
}
