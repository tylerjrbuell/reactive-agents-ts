// Run: bun test packages/reasoning/src/kernel/state/completion-envelope.test.ts
//
// CompletionEnvelope unit contract (#40 / spec §1b): derivation wraps the H5
// authorities, the worst-of join is the ONE aggregate rule, and the result cap
// can downgrade but never upgrade.

import { describe, expect, it } from "bun:test";
import {
  capStatusToEnvelope,
  envelopeFromKernelState,
  joinEnvelopes,
  type CompletionEnvelope,
} from "./completion-envelope.js";
import type { KernelState } from "./kernel-state.js";

const stateWith = (
  status: KernelState["status"],
  meta: Record<string, unknown>,
): KernelState =>
  ({
    status,
    meta,
  }) as unknown as KernelState;

describe("envelopeFromKernelState", () => {
  it("clean done → completed, no markers", () => {
    const env = envelopeFromKernelState(stateWith("done", {}));
    expect(env).toEqual({ completionStatus: "completed" });
  });

  it("done + budgetTerminalPartial → partial with markers (wraps resolveCompletionStatus)", () => {
    const env = envelopeFromKernelState(
      stateWith("done", {
        budgetTerminalPartial: true,
        verificationWarning: "report.md outstanding",
      }),
    );
    expect(env.completionStatus).toBe("partial");
    expect(env.budgetTerminalPartial).toBe(true);
    expect(env.verificationWarning).toContain("report.md");
  });

  it("done + harnessAuthoredOutput → partial", () => {
    const env = envelopeFromKernelState(
      stateWith("done", { harnessAuthoredOutput: true }),
    );
    expect(env.completionStatus).toBe("partial");
    expect(env.harnessAuthoredOutput).toBe(true);
  });

  it("abstention refines a non-failed terminal into abstained", () => {
    const env = envelopeFromKernelState(
      stateWith("done", { abstention: { reason: "missing evidence", missing: ["x"] } }),
    );
    expect(env.completionStatus).toBe("abstained");
    expect(env.abstention?.reason).toBe("missing evidence");
  });

  it("failed is absorbing — abstention never upgrades it", () => {
    const env = envelopeFromKernelState(
      stateWith("failed", { abstention: { reason: "r", missing: [] } }),
    );
    expect(env.completionStatus).toBe("failed");
  });
});

describe("joinEnvelopes — the worst-of aggregate rule (single home)", () => {
  const completed: CompletionEnvelope = { completionStatus: "completed" };

  it("empty join is a clean completed envelope (caller's own authority governs)", () => {
    expect(joinEnvelopes([]).completionStatus).toBe("completed");
  });

  it("any partial member degrades the aggregate", () => {
    const agg = joinEnvelopes([completed, { completionStatus: "partial" }, completed]);
    expect(agg.completionStatus).toBe("partial");
  });

  it("markers OR together and force the aggregate below completed", () => {
    const agg = joinEnvelopes([
      completed,
      { completionStatus: "completed", budgetTerminalPartial: true },
    ]);
    expect(agg.completionStatus).toBe("partial");
    expect(agg.budgetTerminalPartial).toBe(true);
  });

  it("warnings and criteria union without duplicates", () => {
    const agg = joinEnvelopes([
      { completionStatus: "partial", verificationWarning: "w1", outstandingCriteria: ["a"] },
      { completionStatus: "partial", verificationWarning: "w1", outstandingCriteria: ["a", "b"] },
    ]);
    expect(agg.verificationWarning).toBe("w1");
    expect(agg.outstandingCriteria).toEqual(["a", "b"]);
  });
});

describe("capStatusToEnvelope — downgrade allowed, upgrade never", () => {
  it("completed envelope defers to own authority", () => {
    expect(capStatusToEnvelope("completed", { completionStatus: "completed" })).toBe("completed");
    expect(capStatusToEnvelope("partial", { completionStatus: "completed" })).toBe("partial");
  });

  it("non-completed envelope caps completed at partial", () => {
    expect(capStatusToEnvelope("completed", { completionStatus: "partial" })).toBe("partial");
    expect(capStatusToEnvelope("completed", { completionStatus: "abstained" })).toBe("partial");
    expect(capStatusToEnvelope("completed", { completionStatus: "failed" })).toBe("partial");
  });

  it("own failed is absorbing", () => {
    expect(capStatusToEnvelope("failed", { completionStatus: "completed" })).toBe("failed");
  });
});
