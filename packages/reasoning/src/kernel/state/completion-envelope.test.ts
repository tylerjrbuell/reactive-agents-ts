// Run: bun test packages/reasoning/src/kernel/state/completion-envelope.test.ts
//
// CompletionEnvelope unit contract (#40 / spec §1b): derivation wraps the H5
// authorities, the worst-of join is the ONE aggregate rule, and the result cap
// can downgrade but never upgrade.

import { describe, expect, it } from "bun:test";
import {
  capStatusToEnvelope,
  capStatusUnderVerdict,
  envelopeFromKernelState,
  joinEnvelopes,
  readStatusCap,
  type CompletionEnvelope,
  type StatusCapMarker,
} from "./completion-envelope.js";
import type { KernelState } from "./kernel-state.js";
import { makeKernelState } from "../../testing/kernel-fixtures.js";

const stateWith = (
  status: KernelState["status"],
  meta: KernelState["meta"],
): KernelState => makeKernelState({ status, meta });

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

  it("is unchanged by capStatusUnderVerdict: an unmarked partial still caps", () => {
    expect(capStatusToEnvelope("completed", { completionStatus: "partial", outstandingCriteria: ["x"] })).toBe("partial");
  });
});

// D9 follow-up (H3 2026-11-04 false-veto): a plan's verified delivery outranks
// an UNMARKED step-local partial; every honesty marker still caps.
// RED-ON-CUT: delete the `verdict.accepted && verdict.met >= 1` branch and the
// waiver rows fail (status partial, reason envelope-not-completed).
describe("capStatusUnderVerdict — verified delivery waives an unmarked partial only", () => {
  const verified = { accepted: true, met: 5 };
  const partial: CompletionEnvelope = { completionStatus: "partial" };

  it("own failed is absorbing, with no record", () => {
    expect(capStatusUnderVerdict("failed", partial, verified)).toEqual({ status: "failed" });
    expect(capStatusUnderVerdict("failed", { completionStatus: "completed" }, verified)).toEqual({ status: "failed" });
  });

  it("completed envelope defers to own, with no record", () => {
    expect(capStatusUnderVerdict("completed", { completionStatus: "completed" }, verified)).toEqual({ status: "completed" });
    expect(capStatusUnderVerdict("partial", { completionStatus: "completed" }, { accepted: false, met: 0 })).toEqual({ status: "partial" });
  });

  it("waiver: unmarked partial + accepted verdict over >= 1 met condition keeps own", () => {
    expect(capStatusUnderVerdict("completed", partial, verified)).toEqual({
      status: "completed",
      cap: { capped: false, envelopeStatus: "partial", markers: [], reason: "waived-by-verified-delivery" },
    });
    expect(capStatusUnderVerdict("completed", partial, { accepted: true, met: 1 }).status).toBe("completed");
    // own's downgrade survives the waiver (the rule never upgrades)
    expect(capStatusUnderVerdict("partial", partial, verified).status).toBe("partial");
  });

  it("outstandingCriteria is step-scoped, not a marker: the waiver still applies", () => {
    const r = capStatusUnderVerdict("completed", { completionStatus: "partial", outstandingCriteria: ["artifact:./step.md"] }, verified);
    expect(r.status).toBe("completed");
    expect(r.cap?.reason).toBe("waived-by-verified-delivery");
  });

  it("every honesty marker caps at partial, reason honesty-marker", () => {
    const rows: ReadonlyArray<readonly [CompletionEnvelope, readonly StatusCapMarker[]]> = [
      [{ completionStatus: "partial", harnessAuthoredOutput: true }, ["harnessAuthoredOutput"]],
      [{ completionStatus: "partial", budgetTerminalPartial: true }, ["budgetTerminalPartial"]],
      [{ completionStatus: "partial", verificationWarning: "w" }, ["verificationWarning"]],
      [{ completionStatus: "abstained", abstention: { reason: "r", missing: [] } }, ["abstention", "envelope-abstained"]],
      [{ completionStatus: "abstained" }, ["envelope-abstained"]],
      [{ completionStatus: "failed" }, ["envelope-failed"]],
    ];
    for (const [envelope, markers] of rows) {
      expect(capStatusUnderVerdict("completed", envelope, verified)).toEqual({
        status: "partial",
        cap: { capped: true, envelopeStatus: envelope.completionStatus, markers, reason: "honesty-marker" },
      });
    }
  });

  it("no verified delivery: refused verdict, or zero met conditions, caps with envelope-not-completed", () => {
    for (const verdict of [{ accepted: false, met: 4 }, { accepted: true, met: 0 }]) {
      expect(capStatusUnderVerdict("completed", partial, verdict)).toEqual({
        status: "partial",
        cap: { capped: true, envelopeStatus: "partial", markers: [], reason: "envelope-not-completed" },
      });
    }
  });

  it("readStatusCap narrows a record and rejects anything else", () => {
    const cap = capStatusUnderVerdict("completed", partial, verified).cap;
    expect(readStatusCap(cap)).toEqual(cap);
    expect(readStatusCap(undefined)).toBeUndefined();
    expect(readStatusCap({ capped: true, envelopeStatus: "partial", markers: [], reason: "made-up" })).toBeUndefined();
    expect(readStatusCap("waived")).toBeUndefined();
  });
});
