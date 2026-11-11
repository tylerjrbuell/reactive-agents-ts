/**
 * Chat thread scroll rules: the thread follows the stream only while the reader is
 * pinned near the bottom, and "Jump to latest" shows once they scrolled away.
 */

/** Distance from the bottom (px) that still counts as "at the latest turn". */
export const FOLLOW_THRESHOLD_PX = 80;

/** Scroll metrics of the thread element. */
export interface ScrollMetrics {
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly clientHeight: number;
}

/** True when the reader is within the follow threshold of the bottom. */
export function isNearBottom(m: ScrollMetrics, threshold: number = FOLLOW_THRESHOLD_PX): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight < threshold;
}

/** Follow state of the thread: pinned to the bottom, and the scroll top last seen. */
export interface FollowState {
  readonly atBottom: boolean;
  readonly lastTop: number;
}

/**
 * The follow state after a scroll event. Only the reader leaves the bottom: a
 * scroll up unpins, reaching the bottom pins again, and anything else (the
 * thread growing under a pinned reader as markdown renders, a programmatic
 * scroll down) keeps the state. Without this a chat opened at its latest turn
 * landed mid-thread: the content grew before the scroll event fired, the
 * event read "far from the bottom" and following stopped (Bench spec 3.4).
 */
export function followAfterScroll(prev: FollowState, m: ScrollMetrics): FollowState {
  const atBottom = isNearBottom(m) ? true : m.scrollTop < prev.lastTop ? false : prev.atBottom;
  return { atBottom, lastTop: m.scrollTop };
}

/** Whether a store update should scroll the thread to the bottom. */
export function shouldFollow(turnCount: number, atBottom: boolean): boolean {
  return turnCount > 0 && atBottom;
}

/** Whether the "Jump to latest" button shows (never over an open slash menu). */
export function showJumpToLatest(s: { readonly atBottom: boolean; readonly turnCount: number; readonly menuOpen: boolean }): boolean {
  return !s.atBottom && s.turnCount > 0 && !s.menuOpen;
}
