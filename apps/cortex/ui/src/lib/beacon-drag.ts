/**
 * Field drag rules: pure, so the component only forwards pointer events.
 *
 * The bug this replaces: a drop saved the position into `dragged`, and the
 * layout effect then preferred `dragged` over the live position, so the next
 * drag of that node snapped back on every move. Now a drag writes into the
 * same `dragged` map on every move (`dragMove`), and `placedFor` reads only
 * that map (plus the previous layout), so the live drag is always the newest
 * word and every node stays draggable any number of times.
 */
import type { Pos } from "./beacon-layout.js";

/** Plane size in px at the time the drag began. */
export interface PlaneSize {
  readonly width: number;
  readonly height: number;
}

/** One pointer drag in progress. */
export interface DragSession {
  readonly runId: string;
  readonly startX: number;
  readonly startY: number;
  /** The node's position (percent) when the drag began. */
  readonly origin: Pos;
  readonly size: PlaneSize;
}

/** Nodes stay inside these percent bounds of the plane. */
export const DRAG_BOUNDS = { minX: 5, maxX: 93, minY: 5, maxY: 92 } as const;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Keep a position inside the plane. */
export const clampPos = (p: Pos): Pos => ({
  x: clamp(p.x, DRAG_BOUNDS.minX, DRAG_BOUNDS.maxX),
  y: clamp(p.y, DRAG_BOUNDS.minY, DRAG_BOUNDS.maxY),
});

/** Start a drag of `runId` from `origin` with the pointer at (`x`, `y`). */
export function beginDrag(runId: string, pointer: { x: number; y: number }, origin: Pos, size: PlaneSize): DragSession {
  return { runId, startX: pointer.x, startY: pointer.y, origin, size };
}

/** Where the node sits with the pointer at (`x`, `y`). */
export function dragPosition(s: DragSession, pointer: { x: number; y: number }): Pos {
  const w = Math.max(1, s.size.width);
  const h = Math.max(1, s.size.height);
  return clampPos({
    x: s.origin.x + ((pointer.x - s.startX) / w) * 100,
    y: s.origin.y + ((pointer.y - s.startY) / h) * 100,
  });
}

/** The dragged map after a move: the node's new position wins over any older one. */
export function dragMove(
  dragged: ReadonlyMap<string, Pos>,
  s: DragSession,
  pointer: { x: number; y: number },
): Map<string, Pos> {
  return new Map(dragged).set(s.runId, dragPosition(s, pointer));
}

/** Move a node by `dxPx` / `dyPx` (arrow keys). */
export function nudge(p: Pos, dxPx: number, dyPx: number, size: PlaneSize): Pos {
  return clampPos({
    x: p.x + (dxPx / Math.max(1, size.width)) * 100,
    y: p.y + (dyPx / Math.max(1, size.height)) * 100,
  });
}

/** The arrow key's step in px (Shift = a large step); `undefined` for any other key. */
export function nudgeStep(key: string, shift: boolean): { dx: number; dy: number } | undefined {
  const n = shift ? 48 : 12;
  switch (key) {
    case "ArrowLeft":
      return { dx: -n, dy: 0 };
    case "ArrowRight":
      return { dx: n, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -n };
    case "ArrowDown":
      return { dx: 0, dy: n };
    default:
      return undefined;
  }
}

/**
 * The positions the layout must keep for `runIds`: every dragged node at its
 * dragged spot, every other node where the previous layout put it (unless the
 * grid changed, then the layout re-slots them).
 */
export function placedFor(
  runIds: readonly string[],
  dragged: ReadonlyMap<string, Pos>,
  previous: ReadonlyMap<string, Pos>,
  regrid: boolean,
): Map<string, Pos> {
  const placed = new Map<string, Pos>();
  for (const id of runIds) {
    const p = dragged.get(id) ?? (regrid ? undefined : previous.get(id));
    if (p) placed.set(id, p);
  }
  return placed;
}
