import { describe, expect, it } from "bun:test";
import { formatCost, sessionCostSummary } from "./chat-cost.js";
import { hydrateTurn, type ChatTurn } from "./chat-store.js";

const turn = (over: Partial<ChatTurn>): ChatTurn => ({ id: 1, role: "assistant", content: "", tokensUsed: 0, ts: 0, ...over });

describe("hydrateTurn", () => {
  it("restores persisted costUsd and costKnown", () => {
    const t = hydrateTurn({ ...turn({}), costUsd: 0.0042, costKnown: false });
    expect(t.costUsd).toBe(0.0042);
    expect(t.costKnown).toBe(false);
  });
});

describe("sessionCostSummary", () => {
  it("is the server totals plus the live cost of a streaming turn", () => {
    const s = sessionCostSummary({ tokens: 100, costUsd: 0.01, costKnown: true }, [
      turn({ id: 1, costUsd: 0.01 }), // already inside server totals: not added again
      turn({ id: 2, streaming: true, liveCost: 0.002, liveTokens: 30 }),
    ]);
    expect(s.costUsd).toBeCloseTo(0.012, 6);
    expect(s.tokens).toBe(130);
    expect(s.costKnown).toBe(true);
  });
  it("without totals (not loaded) it is zero plus live", () => {
    expect(sessionCostSummary(undefined, [turn({ streaming: true, liveCost: 0.5 })]).costUsd).toBe(0.5);
  });
  it("carries costKnown:false from the server", () => {
    expect(sessionCostSummary({ tokens: 1, costUsd: 0.1, costKnown: false }, []).costKnown).toBe(false);
  });
});

describe("formatCost", () => {
  it("renders a dash for unknown zero, a lower bound for unknown positive, and dollars otherwise", () => {
    expect(formatCost(0, false)).toBe("—");
    expect(formatCost(0.0123, false)).toBe("≥ $0.0123");
    expect(formatCost(0.0123, true)).toBe("$0.0123");
    expect(formatCost(0, true)).toBe("$0.0000");
    expect(formatCost(0.00000795, true)).toBe("<$0.0001");
  });
});
