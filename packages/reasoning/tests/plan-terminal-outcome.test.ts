import { describe, it, expect } from "bun:test";
import {
  GROUNDED_ABSTENTION_REASON,
  planTerminalOutcome,
  type PlanOutcomeInput,
} from "../src/strategies/plan-execute/terminal-outcome.js";

// The status cap under the delivery verdict (waived / honesty-marker /
// envelope-not-completed), the final_answer claim and the honesty-marker relay
// moved to the strategy substrate (tests/strategies/strategy-run.test.ts,
// src/kernel/state/completion-envelope.test.ts). What stays plan-execute's is
// its own abstention and budget-stop outcome.
const base: PlanOutcomeInput = {
  groundedAbstained: false,
  groundedAbstainMissing: [],
  budgetStopped: false,
  budgetLimits: undefined,
  spend: { tokens: 100, cost: 0 },
};

describe("planTerminalOutcome", () => {
  it("a normal end has no outcome (the substrate judges it under the delivery verdict)", () => {
    expect(planTerminalOutcome(base)).toBeUndefined();
  });

  it("grounded abstention carries the descriptor's reason and the still-missing tools", () => {
    expect(planTerminalOutcome({ ...base, groundedAbstained: true, groundedAbstainMissing: ["web-search"] })).toEqual({
      _tag: "Abstained",
      reason: GROUNDED_ABSTENTION_REASON,
      missing: ["web-search"],
    });
    expect(GROUNDED_ABSTENTION_REASON).toBe("Required tools were never successfully executed; the answer is ungrounded.");
  });

  it("a budget stop names the raw reason and the harness warning with the spent tokens", () => {
    const o = planTerminalOutcome({ ...base, budgetStopped: true });
    expect(o?._tag).toBe("BudgetStopped");
    if (o?._tag !== "BudgetStopped") return;
    expect(o.rawReason).toBe("budget-limit");
    expect(o.warning).toStartWith("Token budget exhausted at 100 tokens");
  });

  it("a budget stop against a declared token limit carries the open-string budget-limit reason", () => {
    const o = planTerminalOutcome({ ...base, budgetStopped: true, budgetLimits: { tokenLimit: 50 }, spend: { tokens: 120, cost: 0 } });
    expect(o?._tag === "BudgetStopped" ? o.rawReason : undefined).toMatch(/^budget-limit:tokens:120\/50$/);
  });
});
