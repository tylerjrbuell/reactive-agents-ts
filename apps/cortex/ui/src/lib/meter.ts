/**
 * Value rules for `kit/Meter.svelte`: a flat 4px bar (Bench spec section 5.1
 * replaces the gel progress bars). The fill is a 0..1 fraction of `max`.
 */

/** `value / max` clamped to 0..1; 0 for a non-positive `max` or a non-finite value. */
export function meterFraction(value: number, max: number = 1): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** The fill width as a CSS percentage, e.g. `42.5%`. */
export function meterWidth(value: number, max: number = 1): string {
  return `${Math.round(meterFraction(value, max) * 1000) / 10}%`;
}
