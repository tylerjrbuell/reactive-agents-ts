import { describe, expect, test } from "bun:test";
import { applyMotion, motionAttribute, MOTION_OPTIONS, parseMotion, type MotionTarget } from "./motion.js";

function fakeRoot(): MotionTarget & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  return {
    attrs,
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
  };
}

describe("motion setting", () => {
  test("parses stored values, defaulting to system", () => {
    expect(parseMotion("reduce")).toBe("reduce");
    expect(parseMotion("system")).toBe("system");
    expect(parseMotion(undefined)).toBe("system");
    expect(parseMotion("fast")).toBe("system");
  });

  test("only reduce sets the attribute", () => {
    expect(motionAttribute("reduce")).toBe("reduce");
    expect(motionAttribute("system")).toBeNull();
  });

  test("applyMotion sets and clears html[data-motion]", () => {
    const root = fakeRoot();
    applyMotion(root, "reduce");
    expect(root.attrs.get("data-motion")).toBe("reduce");
    applyMotion(root, "system");
    expect(root.attrs.has("data-motion")).toBe(false);
  });

  test("labels follow the spec wording", () => {
    expect(MOTION_OPTIONS.map((o) => o.label)).toEqual(["Follow the system setting", "Reduce motion"]);
  });
});
