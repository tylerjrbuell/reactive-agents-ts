import type { KernelMessage } from "../strategies/kernel/kernel-state.js";
import type { ContextProfile } from "./context-profile.js";

/** Full-turn window sizes per model tier. */
const FULL_TURNS_BY_TIER: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
};

/** Rough token estimate: 4 chars ≈ 1 token */
function estimateTokens(messages: readonly KernelMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const toolCallTokens = "toolCalls" in m && m.toolCalls
      ? JSON.stringify(m.toolCalls).length / 4
      : 0;
    return sum + content.length / 4 + toolCallTokens;
  }, 0);
}

/** Split messages into assistant+tool_result groups (turns) */
function groupTurns(messages: readonly KernelMessage[]): KernelMessage[][] {
  const groups: KernelMessage[][] = [];
  let current: KernelMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (current.length > 0) groups.push(current);
      current = [msg];
    } else if (msg.role === "tool_result") {
      current.push(msg);
    }
    // user messages are handled separately
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Summarize old turns into a single compressed user message */
function summarizeTurns(turns: KernelMessage[][]): KernelMessage {
  const summaryParts = turns.map((turn) => {
    const assistant = turn.find(m => m.role === "assistant");
    const toolCalls = "toolCalls" in (assistant ?? {}) ? (assistant as any).toolCalls : undefined;
    if (toolCalls && toolCalls.length > 0) {
      const toolNames = toolCalls.map((tc: any) => tc.name).join(", ");
      const results = turn
        .filter(m => m.role === "tool_result")
        .map(m => m.content.slice(0, 100))
        .join("; ");
      return `called ${toolNames} → ${results}`;
    }
    return (assistant?.content ?? "").slice(0, 100);
  }).filter(Boolean);

  return {
    role: "user",
    content: `[Summary of prior work: ${summaryParts.join(" | ")}]`,
  };
}

/**
 * Apply sliding window compaction to keep messages within token budget.
 * - Always keeps first user message (the task)
 * - Keeps last N full turns in detail (tier-adaptive)
 * - Summarizes older turns into one compact message
 */
export function applyMessageWindow(
  messages: readonly KernelMessage[],
  profile: ContextProfile,
): readonly KernelMessage[] {
  if (messages.length === 0) return messages;

  const budgetPercent = profile.contextBudgetPercent ?? 80;
  // Use a reasonable token budget based on budget percent; default context ~8192 tokens
  const budget = (8192 * budgetPercent) / 100;
  const currentTokens = estimateTokens(messages);

  if (currentTokens <= budget) return messages;

  const tier = profile.tier ?? "mid";
  const fullTurns = FULL_TURNS_BY_TIER[tier] ?? 3;

  const [firstMsg, ...rest] = messages;
  if (!firstMsg) return messages;

  const turns = groupTurns(rest);
  if (turns.length <= fullTurns) return messages;

  const oldTurns = turns.slice(0, turns.length - fullTurns);
  const recentTurns = turns.slice(turns.length - fullTurns);

  const summaryMsg = summarizeTurns(oldTurns);
  const recentMessages = recentTurns.flat();

  return [firstMsg, summaryMsg, ...recentMessages];
}
