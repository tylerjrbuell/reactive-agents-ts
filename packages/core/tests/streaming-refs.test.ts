import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import { ApprovalDecisionRef } from "../src/index.js";

describe("ApprovalDecisionRef", () => {
  it("defaults to null and is locally overridable", async () => {
    const prog = Effect.gen(function* () {
      const base = yield* FiberRef.get(ApprovalDecisionRef);
      const scoped = yield* FiberRef.get(ApprovalDecisionRef).pipe(
        Effect.locally(ApprovalDecisionRef, {
          gateId: "g1",
          status: "approved" as const,
        }),
      );
      return { base, scoped };
    });
    const { base, scoped } = await Effect.runPromise(prog);
    expect(base).toBeNull();
    expect(scoped?.gateId).toBe("g1");
    expect(scoped?.status).toBe("approved");
  });
});
