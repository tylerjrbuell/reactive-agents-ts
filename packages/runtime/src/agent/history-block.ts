import type { ChatMessage } from "../chat.js";
import { applyHistoryWindow, formatHistoryBlock } from "../gateway-context-formatting.js";
import { prependTaskText, type TaskInput } from "./task-input.js";

/**
 * Fold prior conversation turns into the task as a labeled reference block —
 * the same presentation the gateway uses (gateway-context-formatting.ts). This
 * keeps the kernel's native-FC tool thread clean: seeding plain-text prior
 * "assistant" final-answers directly into `state.messages` made the model treat
 * them as its own tool-orchestration turns and re-run tools / conflate context.
 * History as labeled text in the task avoids that while staying history-aware.
 * Media parts in a parts input are kept.
 */
export function withHistoryBlock(input: string, history?: readonly ChatMessage[]): string;
export function withHistoryBlock(input: TaskInput, history?: readonly ChatMessage[]): TaskInput;
export function withHistoryBlock(input: TaskInput, history?: readonly ChatMessage[]): TaskInput {
  if (!history || history.length === 0) return input;
  const block = formatHistoryBlock(applyHistoryWindow(history));
  if (!block) return input;
  return prependTaskText(input, (text) => `${block}\n\n--- Current message ---\n${text}`);
}
