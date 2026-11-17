import { describe, expect, test } from "bun:test";
import {
  fieldGrid,
  fieldHeightFor,
  layoutPositions,
  type CanvasSize,
  loadPositions,
  savePositions,
  type LayoutAgent,
  type Pos,
  type PositionStorage,
} from "./beacon-layout.js";

const a = (runId: string, connectedAt: number, parentRunId?: string): LayoutAgent => ({
  runId,
  connectedAt,
  ...(parentRunId ? { parentRunId } : {}),
});
const parents = (list: LayoutAgent[]): Map<string, string> =>
  new Map(list.flatMap((x) => (x.parentRunId ? [[x.runId, x.parentRunId] as const] : [])));

const set: LayoutAgent[] = [
  a("r1", 100),
  a("r2", 200),
  a("c1", 150, "r1"),
  a("c2", 160, "r1"),
  a("r3", 300),
];

describe("layoutPositions", () => {
  test("same runs in any arrival order give identical positions", () => {
    const base = layoutPositions(set, parents(set), new Map());
    const rev = [...set].reverse();
    const shuffled = [set[3]!, set[0]!, set[4]!, set[2]!, set[1]!];
    for (const order of [rev, shuffled]) {
      const got = layoutPositions(order, parents(order), new Map());
      for (const [id, p] of base) expect(got.get(id)).toEqual(p);
    }
  });

  test("children sit below their parent regardless of arrival", () => {
    const out = layoutPositions([...set].reverse(), parents(set), new Map());
    const p = out.get("r1")!;
    expect(out.get("c1")!.y).toBeGreaterThan(p.y);
    expect(out.get("c2")!.y).toBeGreaterThan(p.y);
    expect(out.get("c1")!.x).not.toBe(out.get("c2")!.x);
  });

  test("adding a node never moves placed ones", () => {
    const first = layoutPositions(set, parents(set), new Map());
    const more = [...set, a("r0", 50), a("c3", 170, "r1")];
    const next = layoutPositions(more, parents(more), first);
    for (const [id, p] of first) expect(next.get(id)).toEqual(p);
    expect(next.has("r0")).toBe(true);
    expect(next.has("c3")).toBe(true);
  });

  test("dragged (placed) position overrides computed and survives storage roundtrip", () => {
    const store = new Map<string, string>();
    const storage: PositionStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
    };
    const dragged: Pos = { x: 12.5, y: 33 };
    const placed = new Map<string, Pos>([["r2", dragged]]);
    const out = layoutPositions(set, parents(set), placed);
    expect(out.get("r2")).toEqual(dragged);
    savePositions(storage, out);
    const loaded = loadPositions(storage);
    expect(loaded.get("r2")).toEqual(dragged);
    const again = layoutPositions(set, parents(set), loaded);
    for (const [id, p] of out) expect(again.get(id)).toEqual(p);
  });

  test("storage failures and garbage are tolerated", () => {
    const bad: PositionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadPositions(bad).size).toBe(0);
    expect(() => savePositions(bad, new Map([["x", { x: 1, y: 1 }]]))).not.toThrow();
    const junk: PositionStorage = { getItem: () => "{nope", setItem: () => undefined };
    expect(loadPositions(junk).size).toBe(0);
    const partial: PositionStorage = {
      getItem: () => JSON.stringify({ ok: { x: 1, y: 2 }, bad: { x: "a" }, worse: 5 }),
      setItem: () => undefined,
    };
    expect([...loadPositions(partial).keys()]).toEqual(["ok"]);
  });
});

/** Pixel centres of a layout on a canvas. */
const px = (p: Pos, c: CanvasSize) => ({ x: (p.x / 100) * c.width, y: (p.y / 100) * c.height });
/** A rendered node: 168px label chip, at most ~104px tall (BeaconNode.svelte). */
const NODE_PX = { width: 168, height: 104 };
/** True when two node footprints overlap on the canvas. */
const overlaps = (p: Pos, q: Pos, c: CanvasSize): boolean => {
  const a1 = px(p, c);
  const b1 = px(q, c);
  return Math.abs(a1.x - b1.x) < NODE_PX.width && Math.abs(a1.y - b1.y) < NODE_PX.height;
};
const pairs = (out: Map<string, Pos>, c: CanvasSize): string[] => {
  const list = [...out];
  const bad: string[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (overlaps(list[i]![1], list[j]![1], c)) bad.push(`${list[i]![0]}~${list[j]![0]}`);
  return bad;
};

// The live desk at 1280: 17 test runs, one parent with 4 sub-agents (2026-11-11 QA).
const desk: LayoutAgent[] = [
  ...Array.from({ length: 17 }, (_, i) => a(`t${String(i).padStart(2, "0")}`, 1000 + i * 10)),
  a("crypto", 500),
  ...["btc", "eth", "xrp", "xlm"].map((n, i) => a(n, 510 + i, "crypto")),
];

describe("layoutPositions on a measured canvas", () => {
  for (const canvas of [
    { width: 1214, height: 570 },
    { width: 1854, height: 850 },
    { width: 702, height: 794 },
  ]) {
    test(`no two nodes overlap while slots remain (${canvas.width}x${canvas.height})`, () => {
      const grid = fieldGrid(canvas);
      const list = desk.slice(0, Math.min(desk.length, grid.cols * grid.rows));
      const out = layoutPositions(list, parents(list), new Map(), { canvas });
      expect(out.size).toBe(list.length);
      expect(pairs(out, canvas)).toEqual([]);
    });
  }

  test("sub-agents sit in the row under their parent, beside each other", () => {
    const canvas = { width: 1214, height: 570 };
    const out = layoutPositions(desk, parents(desk), new Map(), { canvas });
    const parent = out.get("crypto")!;
    const kids = ["btc", "eth", "xrp", "xlm"].map((k) => out.get(k)!);
    for (const k of kids) expect(k.y).toBeGreaterThan(parent.y);
    expect(new Set(kids.map((k) => k.y)).size).toBe(1);
    expect(new Set(kids.map((k) => k.x)).size).toBe(4);
    const xs = kids.map((k) => k.x);
    expect(parent.x).toBeGreaterThan(Math.min(...xs));
    expect(parent.x).toBeLessThan(Math.max(...xs));
  });

  test("a Field grown to fieldHeightFor gives every node its own slot (768 viewport)", () => {
    const width = 702;
    const canvas = { width, height: Math.max(570, fieldHeightFor(desk.length, width)) };
    const out = layoutPositions(desk, parents(desk), new Map(), { canvas });
    expect(out.size).toBe(desk.length);
    expect(pairs(out, canvas)).toEqual([]);
  });

  test("a dragged node keeps its spot and new nodes avoid it", () => {
    // The Field grows to fieldHeightFor, so every node has a slot (the node footprint is now 132px tall).
    const canvas = { width: 1214, height: Math.max(570, fieldHeightFor(desk.length + 1, 1214)) };
    const free = layoutPositions(desk, parents(desk), new Map(), { canvas });
    const dragged = new Map<string, Pos>([["t05", free.get("crypto")!]]);
    const out = layoutPositions(desk, parents(desk), dragged, { canvas });
    expect(out.get("t05")).toEqual(free.get("crypto"));
    expect(pairs(out, canvas)).toEqual([]);
  });

  test("Arrange order puts ranked roots first", () => {
    const canvas = { width: 1214, height: 570 };
    const rank = (id: string) => (id === "t16" ? 0 : 1);
    const out = layoutPositions(desk, parents(desk), new Map(), { canvas, rootRank: rank });
    const first = [...out].sort(([, p], [, q]) => p.y - q.y || p.x - q.x)[0]!;
    expect(first[0]).toBe("t16");
  });

  test("past capacity every node still gets a position on the canvas", () => {
    const canvas = { width: 400, height: 300 };
    const out = layoutPositions(desk, parents(desk), new Map(), { canvas });
    expect(out.size).toBe(desk.length);
    for (const p of out.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});
