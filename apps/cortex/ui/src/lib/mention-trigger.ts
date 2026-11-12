/**
 * The `@file` trigger in the chat composer: the partial `@query` at the caret that
 * opens the workspace file picker. Pure; ChatMentionMenu renders the list.
 *
 * Grammar: `@` at the start of the text or after whitespace / `(`, then the query up
 * to the caret (no whitespace). `a@b.com` is not a trigger. Picking a file removes the
 * typed `@query` (the pick lives in a chip), so the rest of the draft is never touched.
 */

/** The `@partial` before the caret. */
export interface MentionTrigger {
  /** Offset of the `@`. */
  readonly start: number;
  /** Caret offset (end of the partial). */
  readonly end: number;
  /** Text after the `@`. */
  readonly query: string;
}

/** Longest query that still counts as a trigger. */
export const MAX_MENTION_QUERY = 120;

/** The `@partial` ending at `caret`, or null. */
export function mentionTrigger(text: string, caret: number): MentionTrigger | null {
  const end = Math.max(0, Math.min(caret, text.length));
  let i = end;
  while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
  // `i` is the start of the whitespace-free word the caret ends.
  const word = text.slice(i, end);
  const at = word.lastIndexOf("@");
  if (at < 0) return null;
  const start = i + at;
  const before = start === 0 ? "" : text[start - 1]!;
  if (before !== "" && !/[\s(]/.test(before)) return null;
  const query = text.slice(start + 1, end);
  if (query.length > MAX_MENTION_QUERY || query.includes("@")) return null;
  return { start, end, query };
}

/** The text with the typed `@query` removed (a stray space left by the removal is trimmed). */
export function removeMention(text: string, trigger: MentionTrigger): { readonly text: string; readonly caret: number } {
  const head = text.slice(0, trigger.start);
  let tail = text.slice(trigger.end);
  if (head.endsWith(" ") && tail.startsWith(" ")) tail = tail.slice(1);
  return { text: head + tail, caret: head.length };
}
