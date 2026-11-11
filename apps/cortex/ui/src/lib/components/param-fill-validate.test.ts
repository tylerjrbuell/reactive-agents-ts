import { describe, test, expect } from "bun:test";
import { validateParamValues, initialValues, paramSeedKey, paramValue } from "./param-fill-validate.js";
import type { VariableDef } from "../types/agent-config.js";

const v = (o: Partial<VariableDef> & { name: string }): VariableDef => ({ type: "string", required: true, ...o });

describe("initialValues", () => {
  test("prefills from defaults", () => {
    expect(initialValues([v({ name: "a", default: "x" }), v({ name: "b" })])).toEqual({ a: "x", b: "" });
  });
});

describe("paramValue", () => {
  test("unset reads as empty (never undefined), set values pass through", () => {
    expect(paramValue({}, "topic")).toBe("");
    expect(paramValue({ topic: "rust" }, "topic")).toBe("rust");
  });
});

describe("paramSeedKey", () => {
  test("closed dialog has an empty key", () => {
    expect(paramSeedKey(false, [v({ name: "a" })])).toBe("");
  });
  test("same names in a fresh array give the same key (input kept)", () => {
    expect(paramSeedKey(true, [v({ name: "a" }), v({ name: "b" })])).toBe(
      paramSeedKey(true, [v({ name: "a", default: "x" }), v({ name: "b" })]),
    );
  });
  test("names joined with NUL: a name with a space never collides with two names", () => {
    expect(paramSeedKey(true, [v({ name: "a b" })])).not.toBe(paramSeedKey(true, [v({ name: "a" }), v({ name: "b" })]));
    expect(paramSeedKey(true, [v({ name: "a" }), v({ name: "b" })])).toBe("a\u0000b");
  });
});

describe("validateParamValues", () => {
  test("flags missing required", () => {
    expect(validateParamValues([v({ name: "a" })], { a: "" })).toEqual({ a: "Required" });
  });
  test("passes when required filled", () => {
    expect(validateParamValues([v({ name: "a" })], { a: "ok" })).toEqual({});
  });
  test("rejects non-numeric number field", () => {
    expect(validateParamValues([v({ name: "n", type: "number" })], { n: "abc" })).toEqual({ n: "Must be a number" });
  });
  test("rejects enum value not in list", () => {
    expect(validateParamValues([v({ name: "e", type: "enum", enumValues: ["a", "b"] })], { e: "c" })).toEqual({
      e: "Must be one of: a, b",
    });
  });
  test("optional empty is allowed", () => {
    expect(validateParamValues([v({ name: "a", required: false })], { a: "" })).toEqual({});
  });
});
