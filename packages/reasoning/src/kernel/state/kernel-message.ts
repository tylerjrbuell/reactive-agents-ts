import { normalizeContent, type MessageContent } from "@reactive-agents/core";
import type { ToolCallSpec } from "@reactive-agents/tools";

/**
 * Provider-agnostic conversation message for the kernel's native FC conversation history.
 *
 * `content` is `MessageContent` (Plan 9 Phase 4, principle 8): a string, or
 * typed parts when a non-text part is present. Producers go through
 * `normalizeContent`, so text-only content is always ONE string (same bytes,
 * same replay hash). Readers that need text call `contentText`.
 *
 * Leaf module — extracted from kernel-state.ts so synthesis-types.ts (which
 * needs this type) doesn't import the module that itself references
 * synthesis-types.ts's `SynthesisConfig`/`SynthesizedContext` types.
 */
export type KernelMessage =
  | { readonly role: "assistant"; readonly content: MessageContent; readonly toolCalls?: readonly ToolCallSpec[] }
  | {
      readonly role: "tool_result";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly content: MessageContent;
      readonly isError?: boolean;
      readonly storedKey?: string;
      /**
       * The tool gate kept this call out of Act (decide/tool-call-refusals.ts):
       * the tool never ran. `isError` stays true for the model, but failure
       * counters must skip it: a refusal is neither a failure nor a success.
       */
      readonly refused?: true;
    }
  | { readonly role: "user"; readonly content: MessageContent };

/**
 * Canonical form for a seeded thread: every message's content goes through
 * `normalizeContent`, so caller-supplied text-only parts become one string
 * before any kernel reader sees them. Identity for string content.
 */
export const normalizeKernelMessages = (messages: readonly KernelMessage[]): readonly KernelMessage[] =>
  messages.map((m) => (typeof m.content === "string" ? m : { ...m, content: normalizeContent(m.content) }));
