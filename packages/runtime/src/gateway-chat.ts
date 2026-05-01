import type { ChatMessage } from "./chat.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TURNS = 40;
const MAX_CHARS = 8_000;
const MAX_EPISODE_CONTENT = 300;

// ─── Pure Utilities ───────────────────────────────────────────────────────────

/**
 * Window conversation history to at most MAX_TURNS turns and MAX_CHARS total.
 * Drops oldest turns first. The full history is preserved for persistence —
 * this only affects what gets injected into the LLM instruction.
 */
export function applyHistoryWindow(history: readonly ChatMessage[]): ChatMessage[] {
  let windowed = history.slice(-MAX_TURNS);
  let totalChars = windowed.reduce((sum, m) => sum + m.content.length, 0);
  while (windowed.length > 0 && totalChars > MAX_CHARS) {
    totalChars -= windowed[0]!.content.length;
    windowed = windowed.slice(1);
  }
  return windowed;
}

/**
 * Format a windowed history slice as a labeled conversation block.
 */
export function formatHistoryBlock(history: readonly ChatMessage[]): string {
  if (history.length === 0) return "";
  const lines = history.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `--- Conversation history ---\n${lines.join("\n")}`;
}

/**
 * Format recent episodic entries as a gateway activity block.
 */
export function formatEpisodicContext(
  episodes: readonly { eventType?: string; content?: string }[],
): string {
  if (episodes.length === 0) return "";
  const lines = episodes.map((e) => {
    const tag = e.eventType ?? "episodic";
    const body = String(e.content ?? "").slice(0, MAX_EPISODE_CONTENT);
    return `[${tag}] ${body}`;
  });
  return `--- Recent gateway activity ---\n${lines.join("\n")}`;
}

/**
 * Build the full enriched instruction sent to executeEvent().
 * Stacks: episodic context → conversation history → behavioral nudge → user message.
 */
export function buildEnrichedInstruction(params: {
  sender: string;
  platform: string;
  mcpServer: string;
  message: string;
  historyBlock: string;
  episodicBlock: string;
}): string {
  const parts: string[] = [];
  if (params.episodicBlock) parts.push(params.episodicBlock);
  if (params.historyBlock) parts.push(params.historyBlock);
  parts.push(
    `You are in a live conversation with ${params.sender} on ${params.platform}.\n` +
    `If this task will take multiple steps or more than a few seconds, ` +
    `send them a brief acknowledgement first using ${params.mcpServer}/send_message_to_user ` +
    `so they aren't left waiting. Keep them informed at meaningful milestones.\n` +
    `Always send your final response via ${params.mcpServer}/send_message_to_user.\n\n` +
    `User: ${params.message}`,
  );
  return parts.join("\n\n");
}
