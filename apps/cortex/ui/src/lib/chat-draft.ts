/**
 * Composer draft replacement. Anything that puts new text into the composer goes
 * through `replaceDraft` so a non-empty draft is never overwritten silently.
 */

export type DraftSwap = {
  /** What the composer holds after the swap. */
  readonly message: string;
  /** The draft that was displaced (non-empty), for a Restore action; `null` when nothing was lost. */
  readonly stash: string | null;
};

/**
 * Put `next` in the composer. The composer's current text is a real draft only when it
 * has content the user typed. Three cases are not drafts and are not stashed:
 * blank text, a typed prefix the user is completing (`next` starts with it), and the
 * quickbar chip command the composer still shows (`chipCmd`, the chip flow restores
 * its own stash).
 */
export function replaceDraft(current: string, next: string, chipCmd: string | null = null): DraftSwap {
  const typed = current.trim();
  if (typed === "") return { message: next, stash: null };
  if (chipCmd !== null && current.trimEnd() === chipCmd.trimEnd()) return { message: next, stash: null };
  if (next.startsWith(typed)) return { message: next, stash: null };
  return { message: next, stash: current };
}

/**
 * Restore a stashed draft as a swap: the stash goes back in the composer and whatever
 * the composer held (the replacement, edited or not) becomes the new stash, offered
 * with its own Restore. Nothing is lost in either direction. A blank composer, or one
 * that already holds exactly the stash, leaves nothing to stash.
 */
export function restoreDraft(current: string, stash: string): DraftSwap {
  if (current.trim() === "" || current === stash) return { message: stash, stash: null };
  return { message: stash, stash: current };
}
