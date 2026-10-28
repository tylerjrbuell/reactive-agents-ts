import { describe, it, expect } from "bun:test";
import { deriveTerminalOutcome, type TerminalOutcomeInput } from "../src/strategies/plan-execute/terminal-outcome.js";
import type { CompletionEnvelope } from "../src/kernel/state/completion-envelope.js";

const cleanEnvelope = { completionStatus: "completed" } as CompletionEnvelope;

const base: TerminalOutcomeInput = {
  finalOutput: "answer",
  groundedAbstained: false,
  groundedAbstainMissing: [],
  budgetStopped: false,
  subKernelEnvelope: cleanEnvelope,
  lastRawTerminatedBy: undefined,
  budgetLimits: undefined,
  totalTokens: 100,
  totalCost: 0,
};

describe("deriveTerminalOutcome", () => {
  it("clean output completes as final_answer with no honesty metadata", () => {
    const o = deriveTerminalOutcome(base);
    expect(o.status).toBe("completed");
    expect(o.terminatedBy).toBe("final_answer");
    expect(o.honestyMetadata).toEqual({});
  });

  it("a partial sub-kernel envelope caps completed to partial and never claims final_answer", () => {
    const o = deriveTerminalOutcome({
      ...base,
      subKernelEnvelope: { completionStatus: "partial", verificationWarning: "w" } as CompletionEnvelope,
    });
    expect(o.status).toBe("partial");
    expect(o.terminatedBy).toBe("end_turn");
    expect(o.honestyMetadata.verificationWarning).toBe("w");
  });

  it("no output is partial / end_turn", () => {
    const o = deriveTerminalOutcome({ ...base, finalOutput: null });
    expect(o.status).toBe("partial");
    expect(o.terminatedBy).toBe("end_turn");
  });

  it("grounded abstention is partial, abstained, and carries the descriptor + rawTerminatedBy", () => {
    const o = deriveTerminalOutcome({ ...base, groundedAbstained: true, groundedAbstainMissing: ["web-search"] });
    expect(o.status).toBe("partial");
    expect(o.terminatedBy).toBe("abstained");
    expect(o.honestyMetadata.rawTerminatedBy).toBe("abstained");
    expect(o.honestyMetadata.abstention).toEqual({
      reason: "Required tools were never successfully executed; the answer is ungrounded.",
      missing: ["web-search"],
    });
  });

  it("a budget stop is partial, flagged harness-authored, and appends to an existing warning", () => {
    const o = deriveTerminalOutcome({
      ...base,
      budgetStopped: true,
      subKernelEnvelope: { completionStatus: "completed", verificationWarning: "prior" } as CompletionEnvelope,
    });
    expect(o.status).toBe("partial");
    expect(o.terminatedBy).toBe("end_turn");
    expect(o.honestyMetadata.budgetTerminalPartial).toBe(true);
    expect(o.honestyMetadata.harnessAuthoredOutput).toBe(true);
    expect(String(o.honestyMetadata.verificationWarning)).toStartWith("prior | Token budget exhausted at 100 tokens");
    expect(o.honestyMetadata.rawTerminatedBy).toBe("budget-limit");
  });
});
