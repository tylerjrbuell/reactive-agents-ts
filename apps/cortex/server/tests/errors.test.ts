import { describe, it, expect } from "bun:test";
import { CortexError, CortexNotFoundError } from "../errors.js";

describe("Cortex errors", () => {
  it("CortexError carries message and optional cause", () => {
    const inner = new Error("inner");
    const err = new CortexError({ message: "outer", cause: inner });
    expect(err._tag).toBe("CortexError");
    expect(err.message).toBe("outer");
    expect(err.cause).toBe(inner);
  });

  it("CortexNotFoundError carries resource id", () => {
    const err = new CortexNotFoundError({ id: "r1", resource: "run" });
    expect(err._tag).toBe("CortexNotFoundError");
    expect(err.id).toBe("r1");
    expect(err.resource).toBe("run");
  });
});
