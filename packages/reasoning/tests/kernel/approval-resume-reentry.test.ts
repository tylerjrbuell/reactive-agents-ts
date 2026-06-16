// Run: bun test packages/reasoning/tests/kernel/approval-resume-reentry.test.ts
//
// Durable HITL (Phase D) — the pure decision mapper for resume re-entry. On a
// resumed run the kernel must apply the human's stored decision WITHOUT
// re-calling the LLM (spec §7 determinism): approved → execute the exact stored
// call; denied → observe the denial and continue; gateId mismatch → no-op.
import { describe, it, expect } from "bun:test";
import { resolveApprovalReentry } from "../../src/kernel/loop/runner.js";

const gate = { gateId: "g1", toolName: "docker", args: { image: "alpine" } };

describe("resolveApprovalReentry", () => {
  it("approved → execute the stored call", () => {
    const r = resolveApprovalReentry(gate, { gateId: "g1", status: "approved" });
    expect(r.action).toBe("execute");
    expect(r.call).toEqual({ name: "docker", arguments: { image: "alpine" } });
  });

  it("denied → observe the denial (includes tool + reason), no execution", () => {
    const r = resolveApprovalReentry(gate, { gateId: "g1", status: "denied", reason: "unsafe" });
    expect(r.action).toBe("observe");
    expect(r.observation).toContain("docker");
    expect(r.observation).toContain("unsafe");
    expect(r.call).toBeUndefined();
  });

  it("denied without a reason still observes", () => {
    const r = resolveApprovalReentry(gate, { gateId: "g1", status: "denied" });
    expect(r.action).toBe("observe");
    expect(r.observation).toContain("docker");
  });

  it("gateId mismatch → no-op (fall through to normal think)", () => {
    const r = resolveApprovalReentry(gate, { gateId: "other", status: "approved" });
    expect(r.action).toBe("none");
  });
});
