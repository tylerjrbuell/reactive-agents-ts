import { describe, expect, test } from "bun:test";
import {
  displayOrder,
  edgeActive,
  filterSelectOptions,
  groupSelectOptions,
  initialActive,
  placeListbox,
  selectedLabel,
  showSearch,
  stepActive,
  typeahead,
  type SelectOption,
} from "./select.js";

const o = (value: string, extra: Partial<SelectOption> = {}): SelectOption => ({ value, label: value, ...extra });
const opts = [o("alpha"), o("beta", { disabled: true }), o("bravo"), o("charlie")];

describe("search box", () => {
  test("appears at nine options, override wins", () => {
    expect(showSearch(8)).toBe(false);
    expect(showSearch(9)).toBe(true);
    expect(showSearch(3, true)).toBe(true);
    expect(showSearch(40, false)).toBe(false);
  });

  test("filter ranks prefix before contains, searches descriptions, keeps order on empty query", () => {
    const list = [o("xalpha"), o("alpha"), o("zed", { description: "alphabet" })];
    expect(filterSelectOptions(list, "").map((x) => x.value)).toEqual(["xalpha", "alpha", "zed"]);
    expect(filterSelectOptions(list, "alp").map((x) => x.value)).toEqual(["alpha", "xalpha", "zed"]);
    expect(filterSelectOptions(list, "nope")).toEqual([]);
  });
});

describe("grouping and labels", () => {
  test("groups keep first-seen order; display order follows groups", () => {
    const list = [o("a", { group: "G1" }), o("b"), o("c", { group: "G1" })];
    expect(groupSelectOptions(list).map((s) => [s.group, s.options.map((x) => x.value)])).toEqual([["G1", ["a", "c"]], ["", ["b"]]]);
    expect(displayOrder(list).map((x) => x.value)).toEqual(["a", "c", "b"]);
  });

  test("selected label: the option, else the raw value, else the placeholder", () => {
    expect(selectedLabel([o("a", { label: "Alpha" })], "a")).toBe("Alpha");
    expect(selectedLabel([o("a")], "custom-model", "Pick one")).toBe("custom-model");
    expect(selectedLabel([o("a")], "", "Pick one")).toBe("Pick one");
  });
});

describe("keyboard navigation", () => {
  test("arrows wrap and skip disabled", () => {
    expect(stepActive(opts, 0, 1)).toBe(2);
    expect(stepActive(opts, 3, 1)).toBe(0);
    expect(stepActive(opts, 0, -1)).toBe(3);
    expect(stepActive(opts, 2, -1)).toBe(0);
    expect(stepActive(opts, -1, 1)).toBe(0);
    expect(stepActive(opts, -1, -1)).toBe(3);
  });

  test("an all-disabled or empty list has no active option", () => {
    expect(stepActive([o("a", { disabled: true })], -1, 1)).toBe(-1);
    expect(stepActive([], 0, 1)).toBe(-1);
  });

  test("home and end skip disabled edges", () => {
    const list = [o("a", { disabled: true }), o("b"), o("c"), o("d", { disabled: true })];
    expect(edgeActive(list, "first")).toBe(1);
    expect(edgeActive(list, "last")).toBe(2);
  });

  test("opens on the chosen option, else the first enabled", () => {
    expect(initialActive(opts, "charlie")).toBe(3);
    expect(initialActive(opts, "beta")).toBe(0);
    expect(initialActive(opts, "")).toBe(0);
  });
});

describe("type-ahead", () => {
  test("a letter jumps to the next match; repeating cycles; a prefix narrows", () => {
    const list = [o("apple"), o("avocado"), o("banana"), o("blueberry")];
    expect(typeahead(list, 0, "", "b", 1000)).toEqual({ buffer: "b", index: 2 });
    expect(typeahead(list, 2, "b", "b", 100)).toEqual({ buffer: "bb", index: 3 });
    expect(typeahead(list, 0, "", "a", 1000).index).toBe(1);
    expect(typeahead(list, 2, "b", "l", 100)).toEqual({ buffer: "bl", index: 3 });
  });

  test("a pause starts a new prefix; no match keeps the position", () => {
    const list = [o("apple"), o("banana")];
    expect(typeahead(list, 1, "ap", "b", 5000)).toEqual({ buffer: "b", index: 1 });
    expect(typeahead(list, 1, "", "z", 5000)).toEqual({ buffer: "z", index: 1 });
  });
});

describe("placement", () => {
  const vp = { width: 1000, height: 700 };
  test("opens below when it fits, at least trigger wide", () => {
    const p = placeListbox({ trigger: { left: 100, top: 100, width: 200, height: 34 }, contentHeight: 200, viewport: vp });
    expect(p).toMatchObject({ side: "down", left: 100, width: 200, top: 138, maxHeight: 320 });
  });

  test("flips up near the bottom and shrinks to the room", () => {
    const p = placeListbox({ trigger: { left: 100, top: 640, width: 200, height: 34 }, contentHeight: 300, viewport: vp });
    expect(p.side).toBe("up");
    expect(p.bottom).toBe(64);
    expect(p.maxHeight).toBeLessThanOrEqual(640 - 12);
  });

  test("stays below when neither side fits but below is larger", () => {
    const p = placeListbox({ trigger: { left: 0, top: 100, width: 100, height: 30 }, contentHeight: 900, viewport: { width: 400, height: 400 } });
    expect(p.side).toBe("down");
    expect(p.maxHeight).toBe(400 - 130 - 12);
  });

  test("never leaves the viewport sideways and respects minWidth", () => {
    const p = placeListbox({ trigger: { left: 950, top: 10, width: 40, height: 30 }, contentHeight: 50, viewport: vp, minWidth: 220 });
    expect(p.width).toBe(220);
    expect(p.left + p.width).toBeLessThanOrEqual(992);
    const narrow = placeListbox({ trigger: { left: 0, top: 10, width: 40, height: 30 }, contentHeight: 50, viewport: { width: 200, height: 400 }, minWidth: 500 });
    expect(narrow.width).toBe(184);
    expect(narrow.left).toBe(8);
  });
});
