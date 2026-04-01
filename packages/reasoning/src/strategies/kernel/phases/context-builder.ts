/**
 * Context Builder — prepares everything the LLM sees on this turn.
 *
 * Pure data transformation: no LLM calls, no Effect services.
 * Fully unit-testable in isolation.
 */
import type { LLMMessage, ProviderAdapter } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../../context/context-profile.js";
import { applyMessageWindow } from "../../../context/message-window.js";
import type { ToolSchema } from "../utils/tool-utils.js";
import type { KernelState, KernelMessage, ReActKernelInput } from "../kernel-state.js";

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

/**
 * Build the system prompt text.
 * Tier-adaptive: frontier/large models get detailed reasoning guidance;
 * mid models get standard guidance; local models get minimal prompt.
 */
export function buildSystemPrompt(
  _task: string,
  systemPrompt?: string,
  tier?: "local" | "mid" | "large" | "frontier",
): string {
  // Use custom system prompt if provided (no task appended — task is in messages[0])
  if (systemPrompt) return systemPrompt;

  // Lean tier-adaptive instruction — NO task, NO tool schemas, NO format rules
  // The task is seeded as state.messages[0] by the execution engine.
  const t = tier ?? "mid";
  if (t === "local") {
    return "You are a helpful assistant. Use the provided tools when needed to complete tasks.";
  }
  if (t === "frontier" || t === "large") {
    return "You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.";
  }
  // mid tier
  return "You are a reasoning agent. Think step by step and use available tools when needed.";
}

// ── toProviderMessage ─────────────────────────────────────────────────────────

/** Convert a KernelMessage to provider-native LLMMessage format. */
export function toProviderMessage(msg: KernelMessage): LLMMessage {
  if (msg.role === "assistant") {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool calls — provider maps to their format
      return {
        role: "assistant",
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          ...msg.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      } as LLMMessage;
    }
    return { role: "assistant", content: msg.content };
  }
  if (msg.role === "tool_result") {
    return {
      role: "tool" as const,
      toolCallId: msg.toolCallId,
      toolName: msg.toolName,
      content: msg.content,
    } as LLMMessage;
  }
  // user role (or fallback)
  return { role: "user", content: msg.content };
}

// ── buildToolSchemas ──────────────────────────────────────────────────────────

const META_TOOL_NAMES = new Set([
  "final-answer",
  "task-complete",
  "context-status",
  "brief",
  "pulse",
  "find",
  "recall",
]);

/**
 * Filter the available tool schemas based on the gate-blocked tools guard.
 * When required tools haven't been called yet and some tools are gate-blocked,
 * only required (unsatisfied) + meta tools are returned to force the model
 * to select the right tool.
 *
 * Accepts either a pre-augmented schema list (with meta-tools already added)
 * or derives it from `input.availableToolSchemas` when schemas is omitted.
 */
export function buildToolSchemas(
  state: KernelState,
  input: ReActKernelInput,
  _profile: ContextProfile,
  schemas?: readonly ToolSchema[],
): readonly ToolSchema[] {
  const effectiveSchemas = schemas ?? ((input.availableToolSchemas ?? []) as ToolSchema[]);
  const gateBlockedTools = (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
  const missingRequired = (input.requiredTools ?? []).filter((t) => !state.toolsUsed.has(t));

  if (gateBlockedTools.length > 0 && missingRequired.length > 0) {
    return effectiveSchemas.filter((ts) =>
      missingRequired.includes(ts.name) || META_TOOL_NAMES.has(ts.name),
    );
  }
  return effectiveSchemas;
}

// ── buildConversationMessages ─────────────────────────────────────────────────

export interface BuildConversationMessagesResult {
  messages: LLMMessage[];
  /** The updated state (synthesizedContext cleared when ICS branch was taken). */
  updatedState: KernelState;
}

/**
 * Build the conversation message list for this LLM turn.
 *
 * Handles two paths:
 *  1. ICS path: synthesizedContext is set → use pre-synthesized messages, clear it
 *  2. Normal path: apply sliding message window + task framing on first iteration
 *
 * In both cases, appends the auto-forward section when present.
 */
export function buildConversationMessages(
  state: KernelState,
  input: ReActKernelInput,
  profile: ContextProfile,
  adapter: ProviderAdapter,
  thoughtPrompt: string,
  autoForwardSection: string,
): BuildConversationMessagesResult {
  let updatedState = state;
  let conversationMessages: LLMMessage[];

  if (state.synthesizedContext) {
    conversationMessages = [...state.synthesizedContext.messages];
    // Clear synthesized context so it isn't replayed next iteration
    updatedState = { ...state, synthesizedContext: null };
    if (autoForwardSection) {
      conversationMessages = [
        ...conversationMessages,
        { role: "user", content: autoForwardSection },
      ];
    }
  } else {
    let compactedMessages = applyMessageWindow(state.messages, profile);
    if (compactedMessages.length === 0) {
      compactedMessages = [{ role: "user" as const, content: thoughtPrompt }];
    }
    // taskFraming hook — on first iteration, let adapter annotate the task message
    // to help local models understand the full sequence of steps required.
    if (
      state.iteration === 0 &&
      compactedMessages.length === 1 &&
      compactedMessages[0]?.role === "user"
    ) {
      const framedTask = adapter.taskFraming?.({
        task: compactedMessages[0].content as string,
        requiredTools: input.requiredTools ?? [],
        tier: profile.tier ?? "mid",
      });
      if (framedTask) {
        compactedMessages = [{ role: "user" as const, content: framedTask }];
      }
    }
    conversationMessages = (compactedMessages as readonly KernelMessage[]).map(toProviderMessage);
  }

  return { messages: conversationMessages, updatedState };
}
