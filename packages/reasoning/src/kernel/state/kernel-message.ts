import type { ToolCallSpec } from "@reactive-agents/tools";

/**
 * Provider-agnostic conversation message for the kernel's native FC conversation history.
 *
 * Leaf module — extracted from kernel-state.ts so synthesis-types.ts (which
 * needs this type) doesn't import the module that itself references
 * synthesis-types.ts's `SynthesisConfig`/`SynthesizedContext` types.
 */
export type KernelMessage =
  | { readonly role: "assistant"; readonly content: string; readonly toolCalls?: readonly ToolCallSpec[] }
  | { readonly role: "tool_result"; readonly toolCallId: string; readonly toolName: string; readonly content: string; readonly isError?: boolean; readonly storedKey?: string }
  | { readonly role: "user"; readonly content: string };
