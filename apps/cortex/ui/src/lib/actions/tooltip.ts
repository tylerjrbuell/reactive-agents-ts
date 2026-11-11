import type { Action } from "svelte/action";
import { settings } from "../stores/settings.js";
import { placeTooltip, type TipSide } from "../tooltip-placement.js";

/**
 * Cortex tooltip: `use:tooltip={"Delete run"}` on any element, in place of a
 * native `title=` (which ignores the theme, the type scale and keyboard focus).
 *
 * One bubble is shared by the whole app and portalled to `<body>` with
 * `position: fixed` on the tooltip layer, so no `overflow` container or
 * transformed ancestor clips it. Hover opens it after a short delay (at once
 * while another tooltip was just open), keyboard focus opens it at once,
 * and Escape, a press, scroll or leaving the trigger close it. Touch never
 * opens it. Settings, Appearance "Hover tooltips" off suppresses it.
 * Placement is `placeTooltip` (`lib/tooltip-placement.ts`); styles are
 * `.cx-tip` in `app.css`.
 */

/** Tooltip text, or text plus options. Empty, `null` or `false` shows nothing. */
export type TooltipParam =
  | string
  | { readonly text: string; readonly placement?: TipSide; readonly disabled?: boolean }
  | null
  | undefined
  | false;

/** A resolved tooltip: trimmed text and its preferred side. */
export interface ResolvedTip {
  readonly text: string;
  readonly placement: TipSide;
}

/** Normalise a {@link TooltipParam}; `null` when it shows nothing. */
export function resolveTip(param: TooltipParam): ResolvedTip | null {
  if (param === null || param === undefined || param === false) return null;
  const raw = typeof param === "string" ? { text: param } : param;
  if ("disabled" in raw && raw.disabled === true) return null;
  const text = raw.text.trim();
  if (text.length === 0) return null;
  return { text, placement: ("placement" in raw && raw.placement) || "top" };
}

/** Hover delay before the first tooltip opens (ms). */
export const TIP_SHOW_DELAY_MS = 450;
/** After a tooltip closes, the next one within this window opens at once (ms). */
export const TIP_WARM_MS = 500;

const BUBBLE_ID = "cx-tip";

interface Bubble {
  readonly root: HTMLDivElement;
  readonly text: HTMLSpanElement;
}

let bubble: Bubble | null = null;
let owner: HTMLElement | null = null;
let ownerTip: ResolvedTip | null = null;
let addedDescribedBy = false;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let lastHiddenAt = 0;
let globalsBound = false;

function ensureBubble(): Bubble {
  if (bubble && bubble.root.isConnected) return bubble;
  const root = document.createElement("div");
  root.id = BUBBLE_ID;
  root.className = "cx-tip";
  root.setAttribute("role", "tooltip");
  root.hidden = true;
  const text = document.createElement("span");
  text.className = "cx-tip-text";
  const caret = document.createElement("span");
  caret.className = "cx-tip-caret";
  caret.setAttribute("aria-hidden", "true");
  root.append(text, caret);
  document.body.appendChild(root);
  bubble = { root, text };
  return bubble;
}

function enabled(): boolean {
  return settings.get().tooltipsEnabled !== false;
}

function cancelShow(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}

function position(): void {
  if (!owner || !bubble || bubble.root.hidden) return;
  const r = owner.getBoundingClientRect();
  const b = bubble.root.getBoundingClientRect();
  const p = placeTooltip({
    trigger: r,
    bubble: { width: b.width, height: b.height },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    placement: ownerTip?.placement,
  });
  bubble.root.style.left = `${Math.round(p.left)}px`;
  bubble.root.style.top = `${Math.round(p.top)}px`;
  bubble.root.style.setProperty("--cx-tip-caret-x", `${Math.round(p.caretX)}px`);
  bubble.root.dataset.side = p.side;
}

function show(node: HTMLElement, tip: ResolvedTip): void {
  cancelShow();
  if (!enabled() || !node.isConnected) return;
  if (owner && owner !== node) hide();
  const b = ensureBubble();
  owner = node;
  ownerTip = tip;
  b.text.textContent = tip.text;
  b.root.style.left = "0px";
  b.root.style.top = "0px";
  b.root.hidden = false;
  position();
  // The bubble describes the trigger unless the trigger already says the same thing.
  const label = node.getAttribute("aria-label")?.trim();
  if (label !== tip.text && !node.hasAttribute("aria-describedby")) {
    node.setAttribute("aria-describedby", BUBBLE_ID);
    addedDescribedBy = true;
  }
}

function hide(): void {
  cancelShow();
  if (owner && addedDescribedBy) owner.removeAttribute("aria-describedby");
  addedDescribedBy = false;
  if (bubble && !bubble.root.hidden) {
    bubble.root.hidden = true;
    lastHiddenAt = Date.now();
  }
  owner = null;
  ownerTip = null;
}

function bindGlobals(): void {
  if (globalsBound) return;
  globalsBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && owner) hide();
  });
  window.addEventListener("scroll", () => owner && hide(), { capture: true, passive: true });
  window.addEventListener("resize", () => owner && hide());
}

/** Svelte action: Cortex's tooltip on any element (see the module comment). */
export const tooltip: Action<HTMLElement, TooltipParam> = (node, param) => {
  let tip = resolveTip(param);
  if (typeof document !== "undefined") bindGlobals();

  const onEnter = (e: PointerEvent) => {
    if (!tip || e.pointerType === "touch") return;
    const current = tip;
    cancelShow();
    if (Date.now() - lastHiddenAt < TIP_WARM_MS || (owner !== null && owner !== node)) {
      show(node, current);
      return;
    }
    showTimer = setTimeout(() => {
      showTimer = null;
      if (tip) show(node, tip);
    }, TIP_SHOW_DELAY_MS);
  };
  const onLeave = () => {
    cancelShow();
    if (owner === node && !node.matches(":focus-within")) hide();
  };
  const onFocusIn = () => {
    // Keyboard focus only: a mouse click focuses too, and must not pop a bubble.
    if (tip && node.matches(":has(:focus-visible), :focus-visible")) show(node, tip);
  };
  const onFocusOut = () => {
    if (owner === node) hide();
  };
  const onPress = () => {
    cancelShow();
    if (owner === node) hide();
  };

  node.addEventListener("pointerenter", onEnter);
  node.addEventListener("pointerleave", onLeave);
  node.addEventListener("focusin", onFocusIn);
  node.addEventListener("focusout", onFocusOut);
  node.addEventListener("pointerdown", onPress);

  return {
    update(next: TooltipParam) {
      tip = resolveTip(next);
      if (owner !== node) return;
      if (!tip) hide();
      else if (bubble) {
        ownerTip = tip;
        bubble.text.textContent = tip.text;
        position();
      }
    },
    destroy() {
      node.removeEventListener("pointerenter", onEnter);
      node.removeEventListener("pointerleave", onLeave);
      node.removeEventListener("focusin", onFocusIn);
      node.removeEventListener("focusout", onFocusOut);
      node.removeEventListener("pointerdown", onPress);
      if (owner === node) hide();
      else cancelShow();
    },
  };
};
