/**
 * Geometry of the Cortex neural mark: eight nodes on an octagon, a ring
 * through them, eight spokes to the core. Same geometry as
 * `static/favicon.svg` (Bench spec section 5.1). `NeuralMark.svelte` renders it.
 */

/** Node colour roles; each maps to a theme-aware `--cortex-mk-*` token. */
export type MarkTone = "violet" | "cyan" | "lilac" | "pale";

/** One outer node: centre, colour role and radius on the 48x48 grid. */
export interface MarkNode {
  readonly x: number;
  readonly y: number;
  readonly tone: MarkTone;
  readonly r: number;
}

/** The eight outer nodes, clockwise from the top left. */
export const MARK_NODES: readonly MarkNode[] = [
  { x: 14, y: 6, tone: "violet", r: 2.8 },
  { x: 34, y: 6, tone: "cyan", r: 2.8 },
  { x: 42, y: 20, tone: "pale", r: 2.4 },
  { x: 42, y: 34, tone: "violet", r: 2.4 },
  { x: 30, y: 44, tone: "cyan", r: 2.8 },
  { x: 18, y: 44, tone: "lilac", r: 2.8 },
  { x: 6, y: 34, tone: "cyan", r: 2.4 },
  { x: 6, y: 20, tone: "lilac", r: 2.4 },
];

/** SVG path data for the octagon ring through the outer nodes. */
export function markRingPath(nodes: readonly MarkNode[] = MARK_NODES): string {
  return nodes
    .map((n, i) => {
      const next = nodes[(i + 1) % nodes.length]!;
      return `M${n.x} ${n.y}L${next.x} ${next.y}`;
    })
    .join("");
}

/** SVG path data for the spokes from the core (24, 24) to each node. */
export function markSpokesPath(nodes: readonly MarkNode[] = MARK_NODES): string {
  return nodes.map((n) => `M24 24L${n.x} ${n.y}`).join("");
}

/** Stroke width for the ring and spokes: thicker below 32px so the mark holds at bar size. */
export function markStroke(size: number): { ring: number; spokes: number } {
  return size < 32 ? { ring: 1.6, spokes: 1.6 } : { ring: 1.2, spokes: 1.3 };
}
