import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { TOAST_BAR_GAP_PX, TOAST_EDGE_PX, reachFromBottom, setToastClearance, toastBottom, toastBottomPx } from "./toast-clearance.js";

describe("toast clearance", () => {
  test("no bar: the stack keeps the edge gap", () => {
    expect(toastBottomPx([])).toBe(TOAST_EDGE_PX);
    expect(toastBottomPx([0, -5, Number.NaN])).toBe(TOAST_EDGE_PX);
  });
  test("the stack sits above the tallest bar (Beacon prompt bar: Run is never covered)", () => {
    expect(toastBottomPx([72])).toBe(72 + TOAST_BAR_GAP_PX);
    expect(toastBottomPx([40.2, 96])).toBe(96 + TOAST_BAR_GAP_PX);
    expect(toastBottomPx([5])).toBe(TOAST_EDGE_PX);
  });
  test("reach is measured from the viewport bottom", () => {
    expect(reachFromBottom(720, 800)).toBe(80);
    expect(reachFromBottom(900, 800)).toBe(0);
  });
  test("registered bars move the shared stack; clearing restores it", () => {
    const a = Symbol("a");
    const b = Symbol("b");
    setToastClearance(a, 70);
    setToastClearance(b, 30);
    expect(get(toastBottom)).toBe(70 + TOAST_BAR_GAP_PX);
    setToastClearance(a, null);
    expect(get(toastBottom)).toBe(30 + TOAST_BAR_GAP_PX);
    setToastClearance(b, null);
    expect(get(toastBottom)).toBe(TOAST_EDGE_PX);
  });
});
