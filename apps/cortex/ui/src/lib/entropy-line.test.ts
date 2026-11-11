import { describe, expect, test } from "bun:test";
import { entropyLabel, entropyLineGeometry } from "./entropy-line.js";

describe("entropyLineGeometry", () => {
  test("spans the width; high entropy plots near the top", () => {
    const g = entropyLineGeometry([0, 1], 100, 24);
    expect(g.points).toEqual([
      { x: 0, y: 22 },
      { x: 100, y: 2 },
    ]);
    expect(g.line).toBe("0,22 100,2");
    expect(g.area).toBe("0,24 0,22 100,2 100,24");
    expect(g.last).toEqual({ x: 100, y: 2 });
  });

  test("clamps out-of-range and non-finite values", () => {
    const g = entropyLineGeometry([-1, 2, Number.NaN], 10, 10);
    expect(g.points.map((p) => p.y)).toEqual([8, 2, 8]);
  });

  test("one value draws a flat line; none draws nothing", () => {
    expect(entropyLineGeometry([0.5], 40, 12).line).toBe("0,6 40,6");
    expect(entropyLineGeometry([], 40, 12)).toEqual({ points: [], line: "", area: "", last: undefined });
  });
});

describe("entropyLabel", () => {
  test("prints the latest value with η", () => {
    expect(entropyLabel([0.1, 0.3])).toBe("η 0.30");
    expect(entropyLabel([])).toBe("η —");
  });
});
