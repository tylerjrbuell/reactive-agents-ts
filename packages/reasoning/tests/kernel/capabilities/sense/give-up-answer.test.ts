// Run: bun test packages/reasoning/tests/kernel/capabilities/sense/give-up-answer.test.ts --timeout 15000
//
// Honest-success support: recognizing a "give-up / incapability" answer and
// whether the run grounded ANYTHING before producing it. A run that claims
// success with only a give-up and no grounded evidence is dishonest (see
// finalize-result.ts's honest-abstention gate).
import { describe, it, expect } from "bun:test";
import type { ReasoningStep } from "../../../../src/types/step.js";
import {
  isGiveUpAnswer,
  hasGroundedEvidence,
  isHarnessForcedTerminal,
} from "../../../../src/kernel/capabilities/sense/give-up-answer.js";

let seq = 0;
function step(
  type: ReasoningStep["type"],
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  seq += 1;
  return {
    id: `g${seq}` as ReasoningStep["id"],
    type,
    content: `${type} content`,
    timestamp: new Date(0),
    ...(metadata ? { metadata } : {}),
  };
}

const obs = (toolName: string, success: boolean): ReasoningStep["metadata"] => ({
  observationResult: {
    success,
    toolName,
    displayText: "x",
    category: "custom",
    resultKind: success ? "data" : "error",
    preserveOnCompaction: false,
    trustLevel: "untrusted",
  },
});

describe("isGiveUpAnswer", () => {
  it("flags apology / incapability statements", () => {
    expect(isGiveUpAnswer("I apologize, but I'm unable to complete this task.")).toBe(true);
    expect(isGiveUpAnswer("I'm sorry, I cannot answer that.")).toBe(true);
  });

  it("flags capability give-ups (no tool / cannot be completed)", () => {
    expect(
      isGiveUpAnswer(
        "The available tools do not include a function for sending Slack messages. Therefore, I cannot complete this task.",
      ),
    ).toBe(true);
    expect(
      isGiveUpAnswer(
        "The system is unable to send a Slack message directly because no tool exists for it. The task cannot be completed with the current toolset.",
      ),
    ).toBe(true);
    expect(isGiveUpAnswer("No tool is registered that can do this.")).toBe(true);
    expect(
      isGiveUpAnswer(
        "The task requires sending a Slack message, but none of the available tools support this action.",
      ),
    ).toBe(true);
  });

  it("does not flag real answers", () => {
    expect(isGiveUpAnswer("The capital of France is Paris.")).toBe(false);
    expect(isGiveUpAnswer("You cannot divide by zero.")).toBe(false);
    expect(isGiveUpAnswer("Hello, team! This is a test message.")).toBe(false);
  });

  it("treats empty/whitespace as not-a-give-up (handled elsewhere)", () => {
    expect(isGiveUpAnswer("")).toBe(false);
    expect(isGiveUpAnswer("   ")).toBe(false);
  });
});

describe("hasGroundedEvidence", () => {
  it("true when a substantive tool succeeded", () => {
    expect(hasGroundedEvidence([step("observation", obs("web-search", true))])).toBe(true);
  });

  it("false when only meta-tools succeeded (recall does not ground)", () => {
    expect(hasGroundedEvidence([step("observation", obs("recall", true))])).toBe(false);
  });

  it("false for harness pseudo-tools (they are not evidence)", () => {
    expect(hasGroundedEvidence([step("observation", obs("system", true))])).toBe(false);
    expect(hasGroundedEvidence([step("observation", obs("completion-guard", true))])).toBe(false);
    expect(hasGroundedEvidence([step("observation", obs("discover-tools", true))])).toBe(false);
  });

  it("false when all observations failed or there are none", () => {
    expect(hasGroundedEvidence([step("observation", obs("web-search", false))])).toBe(false);
    expect(hasGroundedEvidence([step("thought"), step("action")])).toBe(false);
    expect(hasGroundedEvidence([])).toBe(false);
  });
});

describe("isHarnessForcedTerminal", () => {
  it("true for harness-forced ends", () => {
    for (const raw of [
      "loop_graceful",
      "max_iterations",
      "low_delta_guard",
      "switching_exhausted",
      "controller_early_stop:low_delta",
      "loop_detected:repeated",
    ]) {
      expect(isHarnessForcedTerminal(raw)).toBe(true);
    }
  });

  it("false for model-delivered ends and absent reason", () => {
    for (const raw of ["end_turn", "llm_end_turn", "final_answer", "final_answer_tool", "content_stable", undefined]) {
      expect(isHarnessForcedTerminal(raw)).toBe(false);
    }
  });
});
