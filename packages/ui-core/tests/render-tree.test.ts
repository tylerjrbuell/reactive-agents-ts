import { describe, expect, test } from "bun:test";
import { isUiNode, uiTreeSchema, reconcileUiTree } from "../src/render/tree.js";
import type { UiNode } from "../src/render/tree.js";

describe("isUiNode", () => {
  test("accepts a node with a string type", () => {
    expect(isUiNode({ type: "card" })).toBe(true);
  });
  test("rejects non-objects and typeless objects", () => {
    expect(isUiNode(null)).toBe(false);
    expect(isUiNode("card")).toBe(false);
    expect(isUiNode({ props: {} })).toBe(false);
    expect(isUiNode({ type: 42 })).toBe(false);
  });
});

describe("uiTreeSchema", () => {
  test("type enum is the registry keys", () => {
    const schema = uiTreeSchema({ card: {}, table: {} });
    expect(schema.type).toBe("object");
    expect((schema.properties.type as { enum: string[] }).enum).toEqual(["card", "table"]);
  });
});

describe("reconcileUiTree", () => {
  test("undefined prev returns the partial as the tree", () => {
    const out = reconcileUiTree(undefined, { type: "card", props: { title: "a" } });
    expect(out).toEqual({ type: "card", props: { title: "a" } });
  });
  test("non-node partial keeps prev unchanged", () => {
    const prev: UiNode = { type: "card", props: { title: "a" } };
    expect(reconcileUiTree(prev, "not a node")).toEqual(prev);
    expect(reconcileUiTree(prev, undefined)).toEqual(prev);
  });
  test("shallow-merges props, partial wins per key", () => {
    const out = reconcileUiTree(
      { type: "card", props: { title: "a", body: "old" } },
      { type: "card", props: { body: "new" } },
    );
    expect(out?.props).toEqual({ title: "a", body: "new" });
  });
  test("merges children positionally and recursively", () => {
    const prev: UiNode = {
      type: "list",
      children: [{ type: "row", props: { id: 1 } }],
    };
    const partial = {
      type: "list",
      children: [{ type: "row", props: { label: "one" } }, { type: "row", props: { id: 2 } }],
    };
    const out = reconcileUiTree(prev, partial);
    expect(out?.children?.[0]).toEqual({ type: "row", props: { id: 1, label: "one" } });
    expect(out?.children?.[1]).toEqual({ type: "row", props: { id: 2 } });
  });
  test("preserves key from partial then prev", () => {
    expect(reconcileUiTree({ type: "card", key: "k1" }, { type: "card" })?.key).toBe("k1");
    expect(reconcileUiTree({ type: "card", key: "k1" }, { type: "card", key: "k2" })?.key).toBe("k2");
  });
});
