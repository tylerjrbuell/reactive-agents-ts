import type { Action } from "svelte/action";

/** Options for {@link clickOutside}. */
export interface ClickOutsideOptions {
  /** Called on a press outside the node, or on Escape. */
  readonly onclose: (reason: "outside" | "escape") => void;
  /** Extra elements that count as inside (the trigger that toggles the node). */
  readonly ignore?: readonly (HTMLElement | null | undefined)[];
  /** Whether Escape closes (default true). */
  readonly escape?: boolean;
}

/** Marks a floating layer (a `Select` list) that belongs to its opener: a press inside it is not "outside" for any `clickOutside`. */
export const POPOVER_ATTR = "data-cx-popover";

/** Whether a press on `target` is outside `node`, its `ignore` elements and any marked popover layer. */
export function isOutsidePress(target: EventTarget | null, node: HTMLElement, ignore: readonly (HTMLElement | null | undefined)[] = []): boolean {
  if (!(target instanceof Node)) return false;
  if (node.contains(target) || ignore.some((el) => el?.contains(target))) return false;
  return !(target instanceof Element && target.closest(`[${POPOVER_ATTR}]`));
}

/**
 * Svelte action: close a popover on a press outside it or on Escape. A press
 * on a trigger passed in `ignore` is left to the trigger's own toggle, and a
 * press inside a marked popover layer (a `Select` list portaled to the body)
 * counts as inside. Escape is ignored when a nested control already handled
 * it (`defaultPrevented`), so one Escape closes one layer.
 */
export const clickOutside: Action<HTMLElement, ClickOutsideOptions> = (node, options) => {
  let opts = options;
  const onPointer = (e: PointerEvent): void => {
    if (isOutsidePress(e.target, node, opts.ignore)) opts.onclose("outside");
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || opts.escape === false || e.defaultPrevented) return;
    opts.onclose("escape");
  };
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("keydown", onKey);
  return {
    update(next) {
      opts = next;
    },
    destroy() {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    },
  };
};
