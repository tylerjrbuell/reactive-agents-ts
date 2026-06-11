import { describe, test, expect } from "bun:test";
import { validateParamValues, initialValues } from "./param-fill-validate.js";
import type { VariableDef } from "../types/agent-config.js";

const v = (o: Partial<VariableDef> & { name: string }): VariableDef => ({ type: "string", required: true, ...o });

describe("initialValues", () => {
  test("prefills from defaults", () => {
    expect(initialValues([v({ name: "a", default: "x" }), v({ name: "b" })])).toEqual({ a: "x", b: "" });
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
