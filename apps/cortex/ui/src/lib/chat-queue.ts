/**
 * Pure state for a message typed while a run is still going. The composer stays
 * editable during a run; Enter parks the text in one pending slot that is sent
 * when the run ends normally. Nothing here touches the DOM or the store.
 */

/** The single pending slot: the queued text, or `null` when nothing is queued. */
export type QueuedMessage = string | null;

/**
 * Park `text` in the slot. Blank input is ignored. A second message typed during the
 * same run is appended (newline-separated) so the first is never silently dropped.
 */
export function queueMessage(queued: QueuedMessage, text: string): QueuedMessage {
  const next = text.trim();
  if (next === "") return queued;
  return queued === null ? next : `${queued}\n${next}`;
}

/** One visible line for the "Queued:" row. Whitespace collapses; long text ends in an ellipsis. */
export function queuePreview(queued: string, max = 80): string {
  const line = queued.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * What the composer's send button does. While a run is going an empty input shows
 * stop; typed text is queued instead of sent, except a config command
 * (`chat-live-config.ts`), which applies now (to the next turn).
 */
export function composerAction(input: { sending: boolean; hasText: boolean; configCommand?: boolean }): "send" | "stop" | "queue" {
  if (!input.sending) return "send";
  if (!input.hasText) return "stop";
  return input.configCommand === true ? "send" : "queue";
}

/**
 * Whether the latest assistant turn is a run that reported `success: false`. Such a
 * run ends with a normal `StreamCompleted` (no stream error), so the caller must count
 * it as a failure itself: a queued message must not auto-send into a failing provider.
 */
export function lastRunFailed(turns: readonly { readonly role: string; readonly runFailed?: object }[]): boolean {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i]!.role === "assistant") return turns[i]!.runFailed !== undefined;
  }
  return false;
}

/**
 * Whether the queued message should go out now. `send` only when the run really
 * finished (sending went false from true) and the user did not stop it or it did not
 * fail. Otherwise `keep`: the message stays queued with a visible "Send now" control.
 */
export function queuedAfterRun(input: {
  readonly wasSending: boolean;
  readonly sending: boolean;
  readonly queued: QueuedMessage;
  /** The run ended in an error, reported failure (`lastRunFailed`), or the user pressed stop. */
  readonly aborted: boolean;
}): "send" | "keep" | "none" {
  if (!input.wasSending || input.sending || input.queued === null) return "none";
  return input.aborted ? "keep" : "send";
}
