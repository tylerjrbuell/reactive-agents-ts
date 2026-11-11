/**
 * Toast clearance: the toast stack sits bottom-right, which is where a page's
 * bottom bar keeps its primary action (Beacon's prompt bar and its Run
 * button). A bar registers how far it reaches up from the viewport bottom;
 * the stack sits above the tallest registered bar instead of covering it.
 */
import { derived, writable, type Readable } from "svelte/store";

/** Gap between the viewport edge (or a bar) and the toast stack, in px. */
export const TOAST_EDGE_PX = 24;
/** Gap kept between a registered bar's top edge and the stack, in px. */
export const TOAST_BAR_GAP_PX = 12;

/**
 * The toast stack's `bottom` in px: the edge gap, or above the tallest bar
 * (its reach from the viewport bottom plus the bar gap) when that is higher.
 * Non-finite or negative reaches are ignored.
 */
export function toastBottomPx(reaches: Iterable<number>): number {
  let bottom = TOAST_EDGE_PX;
  for (const r of reaches) {
    if (!Number.isFinite(r) || r <= 0) continue;
    bottom = Math.max(bottom, Math.ceil(r) + TOAST_BAR_GAP_PX);
  }
  return bottom;
}

/** How far an element's top edge sits above the viewport bottom, in px (0 when below it). */
export function reachFromBottom(rectTop: number, viewportHeight: number): number {
  return Math.max(0, viewportHeight - rectTop);
}

const reaches = writable<ReadonlyMap<symbol, number>>(new Map());

/** Set (or with `null` clear) one bar's reach. */
export function setToastClearance(key: symbol, reach: number | null): void {
  reaches.update((m) => {
    const next = new Map(m);
    if (reach === null) next.delete(key);
    else next.set(key, reach);
    return next;
  });
}

/** The toast stack's `bottom` in px, from every registered bar. */
export const toastBottom: Readable<number> = derived(reaches, (m) => toastBottomPx(m.values()));

/**
 * Svelte action for a bottom bar: keeps its reach registered while mounted
 * (re-measured on resize of the element or the window) and clears it on
 * destroy.
 */
export function toastKeepClear(node: HTMLElement): { destroy: () => void } {
  const key = Symbol("toast-clearance");
  const measure = () => setToastClearance(key, reachFromBottom(node.getBoundingClientRect().top, window.innerHeight));
  measure();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
  ro?.observe(node);
  window.addEventListener("resize", measure);
  return {
    destroy() {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      setToastClearance(key, null);
    },
  };
}
