import { describe, expect, it } from "bun:test";
import {
  beginDrag,
  clampPos,
  DRAG_BOUNDS,
  dragMove,
  dragPosition,
  nudge,
  nudgeStep,
  placedFor,
  type PlaneSize,
} from "./beacon-drag.js";
import { FIELD_NODE, layoutPositions, type LayoutAgent, type Pos } from "./beacon-layout.js";

const size: PlaneSize = { width: 1200, height: 600 };
const agents: LayoutAgent[] = ["a", "b", "c"].map((runId, i) => ({ runId, connectedAt: i }));

/**
 * The component's loop in pure form: every pointer move updates `dragged`, the
 * layout effect re-runs with `placedFor`, and the result is the new layout.
 */
function dragNode(
  layout: Map<string, Pos>,
  dragged: Map<string, Pos>,
  runId: string,
  by: { x: number; y: number },
): { layout: Map<string, Pos>; dragged: Map<string, Pos> } {
  const start = { x: 600, y: 300 };
  const session = beginDrag(runId, start, layout.get(runId)!, size);
  let d = dragged;
  let l = layout;
  for (const step of [0.25, 0.5, 1]) {
    d = dragMove(d, session, { x: start.x + by.x * step, y: start.y + by.y * step });
    l = layoutPositions(agents, new Map(), placedFor(agents.map((a) => a.runId), d, l, false), { canvas: size });
  }
  return { layout: l, dragged: d };
}

describe("Field drag", () => {
  it("two consecutive drags both work, on the same node and on another", () => {
    let layout = layoutPositions(agents, new Map(), new Map(), { canvas: size });
    let dragged = new Map<string, Pos>();
    const a0 = layout.get("a")!;

    ({ layout, dragged } = dragNode(layout, dragged, "a", { x: 100, y: 60 }));
    const a1 = layout.get("a")!;
    expect(a1.x).toBeCloseTo(a0.x + (100 / size.width) * 100, 5);
    expect(a1.y).toBeCloseTo(a0.y + (60 / size.height) * 100, 5);

    // The same node again: the drag that used to snap back after the first drop.
    ({ layout, dragged } = dragNode(layout, dragged, "a", { x: -100, y: -40 }));
    const a2 = layout.get("a")!;
    expect(a2.x).toBeCloseTo(a1.x - (100 / size.width) * 100, 5);
    expect(a2.y).toBeCloseTo(a1.y - (40 / size.height) * 100, 5);

    // A different node, after the first was dragged twice.
    const b1 = layout.get("b")!;
    ({ layout, dragged } = dragNode(layout, dragged, "b", { x: 50, y: 0 }));
    expect(layout.get("b")!.x).toBeCloseTo(b1.x + (50 / size.width) * 100, 5);
    expect(layout.get("a")).toEqual(a2);
  });

  it("a live move replaces the stored drop, so the stale-position override cannot return", () => {
    const first: Pos = { x: 40, y: 40 };
    const stored = new Map<string, Pos>([["a", first]]);
    const live = new Map<string, Pos>([["a", { x: 60, y: 60 }]]);
    // The layout prefers `dragged` ...
    expect(placedFor(["a"], stored, live, false).get("a")).toEqual(first);
    // ... so a move must write INTO `dragged`, after which it wins.
    const moved = dragMove(stored, beginDrag("a", { x: 0, y: 0 }, first, size), { x: 120, y: 60 });
    expect(moved.get("a")).not.toEqual(first);
    expect(placedFor(["a"], moved, live, false).get("a")).toEqual(moved.get("a")!);
  });

  it("keeps a node inside the plane", () => {
    expect(clampPos({ x: -50, y: 500 })).toEqual({ x: DRAG_BOUNDS.minX, y: DRAG_BOUNDS.maxY });
    const s = beginDrag("a", { x: 0, y: 0 }, { x: 50, y: 50 }, size);
    expect(dragPosition(s, { x: 99_999, y: -99_999 })).toEqual({ x: DRAG_BOUNDS.maxX, y: DRAG_BOUNDS.minY });
  });

  it("arrow keys nudge; Shift steps further; other keys do nothing", () => {
    expect(nudgeStep("ArrowRight", false)).toEqual({ dx: 12, dy: 0 });
    expect(nudgeStep("ArrowUp", true)).toEqual({ dx: 0, dy: -48 });
    expect(nudgeStep("Enter", false)).toBeUndefined();
    expect(nudge({ x: 50, y: 50 }, 120, 0, size).x).toBeCloseTo(60, 5);
  });

  it("a regrid drops the previous layout but keeps drags", () => {
    const prev = new Map<string, Pos>([["a", { x: 1, y: 1 }], ["b", { x: 2, y: 2 }]]);
    const drags = new Map<string, Pos>([["a", { x: 9, y: 9 }]]);
    const placed = placedFor(["a", "b"], drags, prev, true);
    expect(placed.get("a")).toEqual({ x: 9, y: 9 });
    expect(placed.has("b")).toBe(false);
  });
});

describe("Field with 60 nodes", () => {
  it("lays out without overlap, parents and sub-agents included", () => {
    const list: LayoutAgent[] = Array.from({ length: 60 }, (_, i) => ({
      runId: `r${String(i).padStart(2, "0")}`,
      connectedAt: i,
      ...(i % 6 === 5 ? { parentRunId: `r${String(i - 1).padStart(2, "0")}` } : {}),
    }));
    const parentOf = new Map(list.flatMap((x) => (x.parentRunId ? [[x.runId, x.parentRunId] as const] : [])));
    const width = 1200;
    const cols = Math.floor((width - 24) / FIELD_NODE.width);
    const height = 44 + 30 + Math.ceil(60 / cols) * FIELD_NODE.height;
    const out = layoutPositions(list, parentOf, new Map(), { canvas: { width, height } });
    expect(out.size).toBe(60);
    const px = [...out.values()].map((p) => ({ x: (p.x / 100) * width, y: (p.y / 100) * height }));
    let bad = 0;
    for (let i = 0; i < px.length; i++)
      for (let j = i + 1; j < px.length; j++)
        if (Math.abs(px[i]!.x - px[j]!.x) < 168 && Math.abs(px[i]!.y - px[j]!.y) < 128) bad++;
    expect(bad).toBe(0);
  });
});
