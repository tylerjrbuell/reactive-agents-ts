/**
 * emit.test.ts — the discarded-evidence emitters (Wave C / task C1, the D1 win).
 *
 * The concrete audit-01 fix: verify() verdicts and evidence-grounding claims
 * that the terminal path used to COMPUTE-AND-DISCARD now land as ledger facts.
 */
import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../types/index.js";
import type { StepId } from "../../types/step.js";
import { entriesOfKind } from "./run-ledger.js";
import { recordEvidenceClaims, recordTerminalVerdict } from "./emit.js";

function obs(content: string, toolName: string): ReasoningStep {
  return {
    id: ulid() as StepId,
    type: "observation",
    content,
    timestamp: new Date(),
    metadata: {
      observationResult: {
        success: true,
        toolName,
        displayText: content,
        category: "http-get",
        resultKind: "data",
        preserveOnCompaction: false,
        trustLevel: "untrusted",
      },
    },
  };
}

describe("recordTerminalVerdict — the discarded exit verdict (audit 01)", () => {
  it("records a terminal verdict fact from an exit-success verdict", () => {
    const ledger = recordTerminalVerdict([], {
      verified: true,
      terminatedBy: "final_answer",
      reason: "post-conditions met",
      iteration: 7,
    });
    const v = entriesOfKind(ledger, "verdict");
    expect(v.length).toBe(1);
    expect(v[0]?.gate).toBe("terminal");
    expect(v[0]?.verified).toBe(true);
    expect(v[0]?.terminatedBy).toBe("final_answer");
    expect(v[0]?.reason).toBe("post-conditions met");
    expect(v[0]?.iteration).toBe(7);
  });
});

describe("recordEvidenceClaims — claims no longer discarded (audit 01-F2)", () => {
  it("records grounded + ungrounded measurement claims from the final output", () => {
    // corpus contains 90 (grounded) but NOT 40 → "40% faster" is fabricated.
    const steps = [obs("benchmark produced 90 ms runtime", "http-get")];
    const output = "Optimized to 90 ms, a 40% faster result.";
    const ledger = recordEvidenceClaims([], output, steps, undefined, 8);
    const claims = entriesOfKind(ledger, "claim");
    expect(claims.length).toBeGreaterThanOrEqual(2);
    const byGrounded = new Map(claims.map((c) => [c.value, c.grounded]));
    expect(byGrounded.get(90)).toBe(true);
    expect(byGrounded.get(40)).toBe(false);
    expect(claims.every((c) => c.iteration === 8)).toBe(true);
  });

  it("records nothing when the output has no empirical claims", () => {
    const ledger = recordEvidenceClaims([], "A prose answer with no numbers.", [], undefined, 1);
    expect(entriesOfKind(ledger, "claim").length).toBe(0);
  });
});
