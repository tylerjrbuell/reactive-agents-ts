/**
 * Where a tooltip bubble goes (pure; `actions/tooltip.ts` measures and applies).
 *
 * The bubble prefers the requested side, flips when it does not fit, takes the
 * roomier side when neither fits, and is clamped inside the viewport on both
 * axes. The caret points at the trigger's centre, clamped inside the bubble.
 */

/** A viewport rectangle (the subset of `DOMRect` placement reads). */
export interface TipRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Inputs for {@link placeTooltip}. */
export interface TipPlacementInput {
  /** Trigger box in viewport coordinates. */
  readonly trigger: TipRect;
  /** Measured bubble size. */
  readonly bubble: { readonly width: number; readonly height: number };
  /** Viewport size. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** Preferred side (default `top`). */
  readonly placement?: TipSide;
  /** Minimum distance from the viewport edge (default 8). */
  readonly margin?: number;
  /** Distance between trigger and bubble (default 8). */
  readonly gap?: number;
}

/** Which side of the trigger the bubble sits on. */
export type TipSide = "top" | "bottom";

/** Result of {@link placeTooltip}: the bubble's fixed position and caret offset. */
export interface TipPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: TipSide;
  /** Caret centre, px from the bubble's left edge. */
  readonly caretX: number;
}

const CARET_INSET = 14;

/** Compute the bubble position for a trigger; never leaves the viewport. */
export function placeTooltip(input: TipPlacementInput): TipPlacement {
  const { trigger: r, bubble: b, viewport: vp } = input;
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 8;
  const prefer: TipSide = input.placement ?? "top";

  const roomAbove = r.top - margin;
  const roomBelow = vp.height - margin - (r.top + r.height);
  const need = b.height + gap;
  const fits = (s: TipSide): boolean => (s === "top" ? roomAbove : roomBelow) >= need;
  const other: TipSide = prefer === "top" ? "bottom" : "top";
  const side: TipSide = fits(prefer) ? prefer : fits(other) ? other : roomAbove >= roomBelow ? "top" : "bottom";

  const rawTop = side === "top" ? r.top - gap - b.height : r.top + r.height + gap;
  const top = clamp(rawTop, margin, Math.max(margin, vp.height - margin - b.height));

  const cx = r.left + r.width / 2;
  const left = clamp(cx - b.width / 2, margin, Math.max(margin, vp.width - margin - b.width));

  const lo = CARET_INSET;
  const hi = b.width - CARET_INSET;
  const caretX = lo <= hi ? clamp(cx - left, lo, hi) : b.width / 2;

  return { left, top, side, caretX };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}
