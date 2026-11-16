/**
 * Chat session mode (Plan | Execute): labels, the plan-card rule and the keyboard shortcut.
 * Pure so the composer toggle, the thread and the tests share one source. The mode itself lives on
 * the server session (`PUT /api/chat/sessions/:id/mode`) and is independent of the plan-execute
 * reasoning strategy.
 */
import type { ChatTurn } from "./stores/chat-store.js";

export type ChatMode = "plan" | "execute";

export const CHAT_MODES: readonly ChatMode[] = ["plan", "execute"];

export const modeLabel = (mode: ChatMode): string => (mode === "plan" ? "Plan" : "Execute");

/** What the mode means, shown as the Plan note and as the toggle's tooltip. */
export const modeHint = (mode: ChatMode): string =>
  mode === "plan" ? "Reasoning only: no tools until you Execute" : "The agent may use its tools";

export const nextMode = (mode: ChatMode): ChatMode => (mode === "plan" ? "execute" : "plan");

/**
 * The assistant turn that shows the plan card (with its Execute action): in Plan mode, the
 * latest assistant turn when it is the last thing in the thread, finished and has a reply.
 * Once the user answers (or switches mode) the card is done.
 */
export function planCardTurnId(turns: readonly ChatTurn[], mode: ChatMode): number | undefined {
  if (mode !== "plan") return undefined;
  const last = turns.at(-1);
  if (!last || last.role !== "assistant" || last.streaming === true || last.content.trim() === "") return undefined;
  return last.id;
}

/** Keys that toggle the mode: Shift+Tab, except while composing (IME) or typing a slash command. */
export function isModeShortcut(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean },
  draft: string,
): boolean {
  return e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && !draft.startsWith("/");
}
