import { describe, expect, test } from "bun:test";
import { overlayKeyAction, trapFocusIndex } from "./overlay-focus.js";

describe("trapFocusIndex", () => {
  test("wraps at both ends", () => {
    expect(trapFocusIndex(2, 3, false)).toBe(0);
    expect(trapFocusIndex(0, 3, true)).toBe(2);
  });

  test("leaves moves in the middle to the browser", () => {
    expect(trapFocusIndex(1, 3, false)).toBeNull();
    expect(trapFocusIndex(1, 3, true)).toBeNull();
  });

  test("pulls focus in from outside; nothing to trap with no focusables", () => {
    expect(trapFocusIndex(-1, 3, false)).toBe(0);
    expect(trapFocusIndex(-1, 3, true)).toBe(2);
    expect(trapFocusIndex(0, 0, false)).toBeNull();
  });
});

test("Esc closes, Tab traps, other keys pass", () => {
  expect(overlayKeyAction("Escape")).toBe("close");
  expect(overlayKeyAction("Tab")).toBe("trap");
  expect(overlayKeyAction("a")).toBeNull();
});
