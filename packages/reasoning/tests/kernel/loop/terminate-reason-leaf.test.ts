/**
 * terminate-reason-leaf.test.ts
 *
 * `terminate-reason.ts` is a deliberately dependency-free leaf (see its header):
 * `deriveTerminatedBy` lives there so `step-utils.ts` can narrow a terminal
 * reason without closing the cycle react-kernel → act → step-utils → react-kernel.
 * To stay a leaf it re-declares the kernel status union as `KernelStatusLike`
 * instead of importing `KernelState["status"]`.
 *
 * That duplication is only safe while the two unions are identical — pinned here.
 */
import { describe, it, expect } from "bun:test";
import type { KernelStatusLike } from "../../../src/kernel/loop/terminate-reason.js";
import { deriveTerminatedBy } from "../../../src/kernel/loop/terminate-reason.js";
import type { KernelStatus } from "../../../src/kernel/state/kernel-state.js";

// Compile-time equality: either union gaining a member without the other breaks
// the build here, before it can silently change a narrowing at runtime.
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type _StatusUnionsMatch = Assert<Equal<KernelStatusLike, KernelStatus>>;

describe("terminate-reason leaf", () => {
  it("narrows a durable pause to end_turn while preserving the raw reason", () => {
    // A paused run has NOT produced a final answer — narrowing it to
    // `final_answer` would make `goalAchieved` claim a success that never happened.
    const derived = deriveTerminatedBy({
      meta: { terminatedBy: "awaiting-approval" },
      status: "done",
    });
    expect(derived.terminatedBy).toBe("end_turn");
    expect(derived.rawTerminatedBy).toBe("awaiting-approval");
  });

  it("keeps the existing whitelist behaviour for model answers", () => {
    expect(
      deriveTerminatedBy({ meta: { terminatedBy: "final_answer" }, status: "done" }).terminatedBy,
    ).toBe("final_answer");
    expect(
      deriveTerminatedBy({ meta: {}, status: "thinking" }).terminatedBy,
    ).toBe("max_iterations");
  });
});
