import type { Action } from "svelte/action";

/**
 * Reparents the node to `target` (default `document.body`) so `position: fixed`
 * is viewport-relative. Required when ancestors use `backdrop-filter` or
 * `transform`, which create a containing block and break fixed tooltips.
 */
export const portal: Action<HTMLElement, HTMLElement | undefined> = (node, target) => {
  if (typeof document === "undefined" || target === undefined) {
    return { destroy() {} };
  }
  target.appendChild(node);
  return {
    update(newTarget) {
      if (typeof document === "undefined" || newTarget === undefined) return;
      if (node.parentNode !== newTarget) newTarget.appendChild(node);
    },
    destroy() {
      node.remove();
    },
  };
};
