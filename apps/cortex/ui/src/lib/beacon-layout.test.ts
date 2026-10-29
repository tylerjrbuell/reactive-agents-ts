import { describe, expect, test } from "bun:test";
import {
  layoutPositions,
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
