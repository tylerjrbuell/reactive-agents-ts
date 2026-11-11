import { describe, expect, test } from "bun:test";
import { resolveTip } from "./tooltip.js";

describe("resolveTip", () => {
  test("a string is the text, top by default, trimmed", () => {
    expect(resolveTip("  Delete run ")).toEqual({ text: "Delete run", placement: "top" });
  });

  test("options carry the placement", () => {
    expect(resolveTip({ text: "Open", placement: "bottom" })).toEqual({ text: "Open", placement: "bottom" });
  });

  test("empty, missing, false or disabled shows nothing", () => {
    expect(resolveTip("")).toBeNull();
    expect(resolveTip("   ")).toBeNull();
    expect(resolveTip(undefined)).toBeNull();
    expect(resolveTip(null)).toBeNull();
    expect(resolveTip(false)).toBeNull();
    expect(resolveTip({ text: "x", disabled: true })).toBeNull();
  });
});
