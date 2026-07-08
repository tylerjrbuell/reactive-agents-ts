/**
 * applytermination-ledger.test.ts — the D1 win, end to end (Wave C / task C1).
 *
 * Proves that applyTermination (the single verdict→state chokepoint) now
 * persists the terminal verdict + the answer's evidence claims onto the run
 * ledger — facts both gates previously computed and discarded (audit 01/01-F2).
 */
import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../types/index.js";
import type { StepId } from "../../types/step.js";
import { applyTermination, type Verdict } from "../capabilities/decide/arbitrator.js";
import { initialKernelState, transitionState } from "../state/kernel-state.js";
import { entriesOfKind } from "./run-ledger.js";

function obs(content: string): ReasoningStep {
  return {
    id: ulid() as StepId,
    type: "observation",
    content,
    timestamp: new Date(),
    metadata: {
      observationResult: {
        success: true,
        toolName: "http-get",
        displayText: content,
        category: "http-get",
        resultKind: "data",
        preserveOnCompaction: false,
        trustLevel: "untrusted",
      },
    },
  };
}

describe("applyTermination → ledger", () => {
  it("exit-success records a terminal verdict + classified evidence claims", () => {
    let state = initialKernelState({ maxIterations: 20, strategy: "reactive", kernelType: "react" });
    state = transitionState(state, { steps: [obs("benchmark measured 90 ms")], iteration: 3 });

    const verdict: Verdict = {
      action: "exit-success",
      output: "Optimized to 90 ms, a 40% faster result.",
      terminatedBy: "final_answer",
    };
    const final = applyTermination(state, verdict);

    const verdicts = entriesOfKind(final.ledger, "verdict");
    const terminal = verdicts.find((v) => v.gate === "terminal");
    expect(terminal?.verified).toBe(true);
    expect(terminal?.terminatedBy).toBe("final_answer");

    const claims = entriesOfKind(final.ledger, "claim");
    const byGrounded = new Map(claims.map((c) => [c.value, c.grounded]));
    expect(byGrounded.get(90)).toBe(true); // 90 is in the corpus
    expect(byGrounded.get(40)).toBe(false); // 40% fabricated
  });

  it("exit-failure records a failure verdict with the error reason", () => {
    const state = initialKernelState({ maxIterations: 20, strategy: "reactive", kernelType: "react" });
    const final = applyTermination(state, {
      action: "exit-failure",
      error: "no substantive grounding",
      terminatedBy: "abstained",
    });
    const terminal = entriesOfKind(final.ledger, "verdict").find((v) => v.gate === "terminal");
    expect(terminal?.verified).toBe(false);
    expect(terminal?.reason).toBe("no substantive grounding");
    expect(terminal?.terminatedBy).toBe("abstained");
  });
});
