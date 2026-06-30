// Run: bun test packages/reasoning/tests/kernel/verify/abstention-legitimacy.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { checkAbstentionLegitimacy } from "../../../src/kernel/capabilities/verify/abstention-legitimacy";

const base = {
  taskRequiresTools: true,
  requiredToolsAttempted: false,
  requiredToolUnavailable: false,
  ungroundedSynthesisRejections: 0,
  iterationsRemaining: 5,
};

describe("checkAbstentionLegitimacy", () => {
  it("rejects a premature abstain (required tools never attempted, iterations remain)", () => {
    const v = checkAbstentionLegitimacy(base);
    expect(v.legitimate).toBe(false);
    expect(v.nudge).toBeDefined();
  }, 15000);

  it("accepts when a required tool is structurally unavailable", () => {
    expect(checkAbstentionLegitimacy({ ...base, requiredToolUnavailable: true }).legitimate).toBe(true);
  }, 15000);

  it("accepts after genuine attempts that could not ground", () => {
    expect(checkAbstentionLegitimacy({ ...base, requiredToolsAttempted: true }).legitimate).toBe(true);
  }, 15000);

  it("accepts after repeated ungrounded synthesis rejections", () => {
    expect(checkAbstentionLegitimacy({ ...base, ungroundedSynthesisRejections: 2 }).legitimate).toBe(true);
  }, 15000);

  it("accepts when the task needs no tools (pure-knowledge decline)", () => {
    expect(checkAbstentionLegitimacy({ ...base, taskRequiresTools: false }).legitimate).toBe(true);
  }, 15000);
});
