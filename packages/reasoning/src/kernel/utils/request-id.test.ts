import { describe, expect, it } from "bun:test";
import { deriveRequestId } from "./diagnostics.js";

describe("deriveRequestId", () => {
  it("is stable for the same task, iteration and kind", () => {
    const a = deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" });
    const b = deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" });
    expect(a).toBe(b);
    expect(a).toBe("t1:2:complete");
  });

  it("separates iterations and kinds", () => {
    expect(deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" }))
      .not.toBe(deriveRequestId({ taskId: "t1", iteration: 3, requestKind: "complete" }));
    expect(deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "complete" }))
      .not.toBe(deriveRequestId({ taskId: "t1", iteration: 2, requestKind: "stream" }));
  });
});
