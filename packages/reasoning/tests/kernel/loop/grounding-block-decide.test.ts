import { describe, it, expect } from "bun:test";
import {
  decideGroundingBlockOutcome,
  findGroundingBlockReject,
  hasNonGroundingBlock,
  DEFAULT_GROUNDING_BLOCK_MAX_RETRIES,
} from "../../../src/kernel/loop/runner-helpers/grounding-block.js";
import type { VerificationResult } from "../../../src/kernel/capabilities/verify/verifier.js";

const groundingRejectVerdict = (): VerificationResult => ({
  verified: false,
  softFail: false,
  severity: "reject",
  action: "final-answer",
  summary: "final-answer: failed at evidence-grounded",
  checks: [
    { name: "action-success", passed: true, severity: "pass" },
    {
      name: "evidence-grounded",
      passed: false,
      severity: "reject",
      reason: "unverified figure: $80,000",
    },
  ],
});

const allPassVerdict = (): VerificationResult => ({
  verified: true,
  softFail: false,
  severity: "pass",
  action: "final-answer",
  summary: "final-answer: 2 checks passed",
  checks: [
    { name: "action-success", passed: true, severity: "pass" },
    { name: "evidence-grounded", passed: true, severity: "pass" },
  ],
});

const groundingWarnVerdict = (): VerificationResult => ({
  verified: false,
  softFail: true,
  severity: "warn",
  action: "final-answer",
  summary: "final-answer: failed at evidence-grounded",
  checks: [
    { name: "action-success", passed: true, severity: "pass" },
    { name: "evidence-grounded", passed: false, severity: "warn", reason: "unverified figure: $80,000" },
  ],
});

describe("findGroundingBlockReject", () => {
  it("finds a failed evidence-grounded reject check", () => {
    const r = findGroundingBlockReject(groundingRejectVerdict());
    expect(r).toBeDefined();
    expect(r?.reason).toContain("80,000");
  });
  it("returns undefined for a warn-severity grounding miss", () => {
    expect(findGroundingBlockReject(groundingWarnVerdict())).toBeUndefined();
  });
  it("returns undefined when grounding passed", () => {
    expect(findGroundingBlockReject(allPassVerdict())).toBeUndefined();
  });
});

describe("decideGroundingBlockOutcome", () => {
  it("pass when grounding config absent (off by default)", () => {
    expect(decideGroundingBlockOutcome(groundingRejectVerdict(), 0, undefined).kind).toBe("pass");
  });

  it("pass in warn mode (advisory rides softFail, not handled here)", () => {
    expect(
      decideGroundingBlockOutcome(groundingWarnVerdict(), 0, { mode: "warn" }).kind,
    ).toBe("pass");
  });

  it("retry on first block-mode reject within budget", () => {
    const out = decideGroundingBlockOutcome(groundingRejectVerdict(), 0, { mode: "block", maxRetries: 1 });
    expect(out.kind).toBe("retry");
    if (out.kind === "retry") expect(out.guidance).toContain("80,000");
  });

  it("degrades to warn once the retry budget is exhausted (never hard-fails)", () => {
    const out = decideGroundingBlockOutcome(groundingRejectVerdict(), 1, { mode: "block", maxRetries: 1 });
    expect(out.kind).toBe("degrade");
    if (out.kind === "degrade") expect(out.warning).toContain("80,000");
  });

  it("honors a custom maxRetries before degrading", () => {
    const cfg = { mode: "block" as const, maxRetries: 2 };
    expect(decideGroundingBlockOutcome(groundingRejectVerdict(), 0, cfg).kind).toBe("retry");
    expect(decideGroundingBlockOutcome(groundingRejectVerdict(), 1, cfg).kind).toBe("retry");
    expect(decideGroundingBlockOutcome(groundingRejectVerdict(), 2, cfg).kind).toBe("degrade");
  });

  it("defaults maxRetries to 1 when unset", () => {
    expect(DEFAULT_GROUNDING_BLOCK_MAX_RETRIES).toBe(1);
    const cfg = { mode: "block" as const };
    expect(decideGroundingBlockOutcome(groundingRejectVerdict(), 0, cfg).kind).toBe("retry");
    expect(decideGroundingBlockOutcome(groundingRejectVerdict(), 1, cfg).kind).toBe("degrade");
  });

  it("pass (defers) when block mode but grounding passed", () => {
    expect(
      decideGroundingBlockOutcome(allPassVerdict(), 0, { mode: "block" }).kind,
    ).toBe("pass");
  });

  it("defers (pass) when a non-grounding reject coexists — grounding must not rescue a parrot", () => {
    const v: VerificationResult = {
      ...groundingRejectVerdict(),
      checks: [
        ...groundingRejectVerdict().checks,
        { name: "output-not-harness-parrot", passed: false, severity: "reject", reason: "parrot" },
      ],
    };
    expect(decideGroundingBlockOutcome(v, 1, { mode: "block", maxRetries: 1 }).kind).toBe("pass");
  });
});

describe("hasNonGroundingBlock", () => {
  it("false when only evidence-grounded rejects", () => {
    expect(hasNonGroundingBlock(groundingRejectVerdict())).toBe(false);
  });
  it("true when a non-grounding reject is present", () => {
    const v: VerificationResult = {
      ...groundingRejectVerdict(),
      checks: [
        ...groundingRejectVerdict().checks,
        { name: "output-not-harness-parrot", passed: false, severity: "reject" },
      ],
    };
    expect(hasNonGroundingBlock(v)).toBe(true);
  });
  it("true when an escalate is present", () => {
    const v: VerificationResult = {
      ...groundingRejectVerdict(),
      checks: [
        ...groundingRejectVerdict().checks,
        { name: "harness-fallback", passed: false, severity: "escalate" },
      ],
    };
    expect(hasNonGroundingBlock(v)).toBe(true);
  });
});
