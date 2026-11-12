/**
 * Where an anchored popover goes (pure; the component measures and applies).
 *
 * The popover opens on the preferred side of its trigger, flips when that side
 * lacks room, takes the roomier side when neither fits, is aligned to the
 * trigger's start or end edge, and is shifted back inside the viewport. When even
 * the roomier side is too short, `maxHeight` caps the popover to the room so it
 * scrolls inside itself instead of leaving the screen.
 */

/** A viewport rectangle (the subset of `DOMRect` placement reads). */
export interface PopRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Which side of the trigger the popover sits on. */
export type PopSide = "top" | "bottom";

/** Inputs for {@link placePopover}. */
export interface PopPlacementInput {
  /** Trigger box in viewport coordinates. */
  readonly trigger: PopRect;
  /** Measured popover size (natural, not capped). */
  readonly size: { readonly width: number; readonly height: number };
  /** Viewport size. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** Preferred side (default `bottom`). */
  readonly side?: PopSide;
  /** Which trigger edge the popover lines up with (default `start`). */
  readonly align?: "start" | "end";
  /** Minimum distance from the viewport edge (default 8). */
  readonly margin?: number;
  /** Distance between trigger and popover (default 6). */
  readonly gap?: number;
}

/** Result of {@link placePopover}: fixed position, chosen side and the height cap. */
export interface PopPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: PopSide;
  /** Tallest the popover may be on this side (px). */
  readonly maxHeight: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** Compute the popover position for a trigger; never leaves the viewport. */
export function placePopover(input: PopPlacementInput): PopPlacement {
  const { trigger: r, size, viewport: vp } = input;
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 6;
  const prefer: PopSide = input.side ?? "bottom";

  const roomAbove = Math.max(0, r.top - gap - margin);
  const roomBelow = Math.max(0, vp.height - margin - (r.top + r.height) - gap);
  const room = (s: PopSide): number => (s === "top" ? roomAbove : roomBelow);
  const other: PopSide = prefer === "top" ? "bottom" : "top";
  const side: PopSide = room(prefer) >= size.height ? prefer : room(other) >= size.height ? other : roomAbove >= roomBelow ? "top" : "bottom";

  const maxHeight = room(side);
  const height = Math.min(size.height, maxHeight);
  const top = side === "top" ? r.top - gap - height : r.top + r.height + gap;

  const rawLeft = input.align === "end" ? r.left + r.width - size.width : r.left;
  const left = clamp(rawLeft, margin, Math.max(margin, vp.width - margin - size.width));

  return { left, top, side, maxHeight };
}
