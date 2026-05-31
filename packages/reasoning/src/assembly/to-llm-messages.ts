/**
 * to-llm-messages.ts — provider-boundary glue.
 *
 * Converts the structural `ProviderRequest.messages` produced by `project()`
 * into the provider-native `LLMMessage[]` the LLM service consumes. This mirrors
 * `toProviderMessage` (kernel/capabilities/attend/context-utils.ts) exactly so the
 * RA_ASSEMBLY thread is wire-shaped identically to the legacy curator thread —
 * isolating the projection/content differences as the only A/B variable.
 *
 * Pure. No `any`: tool-call entries are narrowed with a guard.
 */
import type { LLMMessage, ContentBlock } from "@reactive-agents/llm-provider";
import { sanitizeToolName } from "../kernel/capabilities/attend/context-utils.js";
import type { ProviderRequest } from "./types.js";

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
        const blocks: ContentBlock[] = [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          // Sanitize on replay: names are stored canonically (e.g. MCP
          // `github/list_commits`) but the provider payload requires
          // `^[a-zA-Z0-9_-]+$` — mirror the outbound tools-array sanitization.
          ...m.toolCalls.map(
            (tc): ContentBlock => ({ type: "tool_use", id: tc.id, name: sanitizeToolName(tc.name), input: tc.arguments }),
          ),
        ];
        return { role: "assistant", content: blocks };
      }
      return { role: "assistant", content: m.content };
    }
    if (m.role === "tool_result") {
      return {
        role: "tool",
        toolCallId: m.toolCallId ?? "",
        ...(m.toolName !== undefined ? { toolName: sanitizeToolName(m.toolName) } : {}),
        content: m.content,
      };
    }
    // user (and any other role falls back to a user turn — provider-safe)
    return { role: "user", content: m.content };
  });
}
