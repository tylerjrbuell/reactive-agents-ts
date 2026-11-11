/**
 * Geometry for the small entropy line (`kit/EntropyLine.svelte`, Bench spec
 * section 5.4): the agent's own signal, drawn with the signal gradient on
 * Beacon live cards, run vitals and the run view.
 */

/** One plotted point in SVG user units. */
export interface LinePoint {
  readonly x: number;
  readonly y: number;
}

/** Points, the polyline and the closed area polygon for an entropy series. */
export interface EntropyLineGeometry {
  readonly points: readonly LinePoint[];
  /** `points` attribute for the `<polyline>`. */
  readonly line: string;
  /** `points` attribute for the filled `<polygon>` under the line. */
  readonly area: string;
  /** The last point (the "now" dot), or `undefined` with no data. */
  readonly last: LinePoint | undefined;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * Lay out `values` (entropy, 0..1; out-of-range or non-finite values clamp)
 * across `width` x `height`, with 2px of vertical padding so the stroke is
 * not clipped. A single value draws a flat line across the width.
 */
export function entropyLineGeometry(values: readonly number[], width: number, height: number): EntropyLineGeometry {
  if (values.length === 0) return { points: [], line: "", area: "", last: undefined };
  const series = values.length === 1 ? [values[0]!, values[0]!] : values;
  const span = series.length - 1;
  const points = series.map((v, i) => ({
    x: round((i / span) * width),
    y: round(height - 2 - clamp01(v) * (height - 4)),
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  return { points, line, area: `0,${height} ${line} ${width},${height}`, last: points[points.length - 1] };
}

/** The value printed beside the line: `η 0.30`, or `η —` with no data. */
export function entropyLabel(values: readonly number[]): string {
  const v = values[values.length - 1];
  return v === undefined || !Number.isFinite(v) ? "η —" : `η ${clamp01(v).toFixed(2)}`;
}
