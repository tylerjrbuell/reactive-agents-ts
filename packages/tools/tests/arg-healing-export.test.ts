import { describe, it, expect } from "bun:test";
import {
  healEnumArg,
  healParamNames,
  closestValid,
  type HealedValue,
  type HealedParams,
} from "../src/index.js";

describe("arg-healing package-entry export", () => {
  it("exposes the shared healing helpers", () => {
    const v: HealedValue = healEnumArg("ADD", ["add", "remove"]);
    expect(v).toEqual({ value: "add", healedFrom: "ADD" });
    const p: HealedParams = healParamNames({ text: "x" }, { content: ["text"] });
    expect(p.healed).toEqual(["text->content"]);
    expect(closestValid("remov", ["add", "remove"])).toBe("remove");
  });
});
