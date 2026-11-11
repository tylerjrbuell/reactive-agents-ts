/**
 * Focus rules for `kit/Overlay.svelte` (modal and drawer): Tab cycles inside
 * the open panel, Esc closes it, and focus returns to the trigger on close.
 */

/** Elements that take keyboard focus inside an overlay panel. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Where Tab (or Shift+Tab) should move inside a trap of `count` focusable
 * elements, given the index that has focus now (`-1` when focus is outside).
 * Returns `null` when the browser's default move stays inside the trap.
 */
export function trapFocusIndex(current: number, count: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

/** What a key press does to an open overlay. */
export function overlayKeyAction(key: string): "close" | "trap" | null {
  if (key === "Escape") return "close";
  if (key === "Tab") return "trap";
  return null;
}
