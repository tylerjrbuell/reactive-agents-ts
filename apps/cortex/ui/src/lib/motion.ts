/**
 * Settings · Motion (Bench spec section 5.2). Two triggers stop Cortex's
 * motion with one rule set in `app.css`: the OS `prefers-reduced-motion`, and
 * this setting, which sets `html[data-motion="reduce"]`. "system" leaves the
 * attribute off so the OS setting alone decides.
 */

/** `system` follows the OS setting; `reduce` stops motion regardless. */
export type MotionSetting = "system" | "reduce";

/** The two choices, in display order, with their labels. */
export const MOTION_OPTIONS: readonly { readonly value: MotionSetting; readonly label: string }[] = [
  { value: "system", label: "Follow the system setting" },
  { value: "reduce", label: "Reduce motion" },
];

/** Read a stored value; anything unknown falls back to `system`. */
export function parseMotion(value: unknown): MotionSetting {
  return value === "reduce" ? "reduce" : "system";
}

/** The `data-motion` attribute value for a setting, or `null` to remove it. */
export function motionAttribute(setting: MotionSetting): "reduce" | null {
  return setting === "reduce" ? "reduce" : null;
}

/** Minimal element surface `applyMotion` needs (an `HTMLElement` satisfies it). */
export interface MotionTarget {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Set or clear `data-motion` on `root` (the `<html>` element). */
export function applyMotion(root: MotionTarget, setting: MotionSetting): void {
  const attr = motionAttribute(setting);
  if (attr) root.setAttribute("data-motion", attr);
  else root.removeAttribute("data-motion");
}
