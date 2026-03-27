import type { LLMMessage } from "./types.js";

/**
 * Validates and auto-repairs a message array before sending to any LLM provider.
 * Silent — logs warnings in debug mode, never throws.
 */
export function validateAndRepairMessages(messages: readonly LLMMessage[]): readonly LLMMessage[] {
  if (messages.length === 0) return messages;

  const repaired: LLMMessage[] = [];
  const toolCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // Collect tool call IDs from assistant messages
    if (msg.role === "assistant") {
      const toolCalls = (msg as any).tool_calls ?? (msg as any).toolCalls ?? [];
      for (const tc of toolCalls) {
        if (tc.id) toolCallIds.add(tc.id);
      }
      const content = typeof msg.content === "string" ? msg.content : "";
      repaired.push({ ...msg, content: content || "" });
      continue;
    }

    // Check for orphaned tool_result
    if (msg.role === "tool") {
      const callId = (msg as any).tool_call_id ?? (msg as any).toolCallId;
      if (callId && !toolCallIds.has(callId)) {
        // Orphaned — skip it
        continue;
      }
      repaired.push(msg);
      continue;
    }

    // Repair empty user/system content
    if (msg.role === "user" || msg.role === "system") {
      const content = typeof msg.content === "string" ? msg.content : "";
      if (!content.trim()) {
        repaired.push({ ...msg, content: "..." } as LLMMessage);
        continue;
      }
    }

    repaired.push(msg);
  }

  return repaired;
}
