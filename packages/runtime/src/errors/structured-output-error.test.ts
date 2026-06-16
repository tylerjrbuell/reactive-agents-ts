import { describe, it, expect } from "bun:test";
import { StructuredOutputError } from "./structured-output-error.js";

describe("StructuredOutputError", () => {
  it("carries raw text and issues", () => {
    const e = new StructuredOutputError({ rawText: "not json", issues: ["bad"] });
    expect(e._tag).toBe("StructuredOutputError");
    expect(e.rawText).toBe("not json");
    expect(e.issues).toEqual(["bad"]);
  });
});
