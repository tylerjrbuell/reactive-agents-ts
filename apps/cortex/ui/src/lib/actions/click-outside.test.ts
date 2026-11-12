import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isOutsidePress, POPOVER_ATTR } from "./click-outside.js";

/** Minimal DOM stand-ins: a tree of nodes with `contains` and `closest`. */
class FakeNode {
  parent: FakeNode | null = null;
  attrs = new Set<string>();
  constructor(readonly children: FakeNode[] = []) {
    for (const c of children) c.parent = this;
  }
  contains(other: FakeNode): boolean {
    for (let n: FakeNode | null = other; n; n = n.parent) if (n === this) return true;
    return false;
  }
  closest(sel: string): FakeNode | null {
    const attr = sel.replace(/^\[|\]$/g, "");
    for (let n: FakeNode | null = this; n; n = n.parent) if (n.attrs.has(attr)) return n;
    return null;
  }
}

const g = globalThis as unknown as { Node?: unknown; Element?: unknown };
const saved = { Node: g.Node, Element: g.Element };
beforeAll(() => {
  g.Node = FakeNode;
  g.Element = FakeNode;
});
afterAll(() => {
  g.Node = saved.Node;
  g.Element = saved.Element;
});

const asEl = (n: FakeNode) => n as unknown as HTMLElement;
const asTarget = (n: FakeNode) => n as unknown as EventTarget;

describe("isOutsidePress", () => {
  const inside = new FakeNode();
  const panel = new FakeNode([inside]);
  const trigger = new FakeNode();
  const stranger = new FakeNode();
  const popoverChild = new FakeNode();
  const popover = new FakeNode([popoverChild]);
  popover.attrs.add(POPOVER_ATTR);

  test("a press inside the panel is not outside", () => {
    expect(isOutsidePress(asTarget(inside), asEl(panel))).toBe(false);
    expect(isOutsidePress(asTarget(panel), asEl(panel))).toBe(false);
  });

  test("a press elsewhere is outside", () => {
    expect(isOutsidePress(asTarget(stranger), asEl(panel))).toBe(true);
  });

  test("the ignored trigger counts as inside, so its own toggle decides", () => {
    expect(isOutsidePress(asTarget(trigger), asEl(panel), [asEl(trigger)])).toBe(false);
    expect(isOutsidePress(asTarget(trigger), asEl(panel), [])).toBe(true);
  });

  test("a press inside a portaled popover (a Select list) is not outside", () => {
    expect(isOutsidePress(asTarget(popoverChild), asEl(panel))).toBe(false);
  });

  test("a non-node target is never outside", () => {
    expect(isOutsidePress(null, asEl(panel))).toBe(false);
  });
});
