import { describe, it, expect } from "bun:test";
import { aggregateCohort, compareCohorts } from "../src/cohort.js";
import type { Trace } from "../src/replay.js";
import type { TraceEvent } from "../src/events.js";

// A run trace parameterized by outcome shape, for cohort tests.
function run(
  id: string,
  opts: { tokens: number; deliverable: boolean; substantive: boolean; claimed: boolean },
): Trace {
  let seq = 0;
  const e = (kind: string, iter: number, extra: Record<string, unknown>): TraceEvent =>
    ({ kind, runId: id, timestamp: 0, iter, seq: seq++, ...extra } as unknown as TraceEvent);
  const events: TraceEvent[] = [
    e("kernel-state-snapshot", 0, { status: "thinking", toolsUsed: [], scratchpadKeys: [], stepsCount: 0, stepsByType: {}, outputPreview: null, outputLen: 0, messagesCount: 1, tokens: 0, cost: 0, llmCalls: 0, terminatedBy: undefined, pendingGuidance: undefined }),
  ];
  if (opts.substantive) {
    events.push(e("tool-call-start", 1, { toolName: opts.deliverable ? "file-write" : "file-read" }));
    events.push(e("tool-call-end", 1, { toolName: opts.deliverable ? "file-write" : "file-read", ok: true }));
  } else {
    events.push(e("tool-call-start", 1, { toolName: "pulse" }));
    events.push(e("tool-call-end", 1, { toolName: "pulse", ok: true }));
  }
  events.push(e("kernel-state-snapshot", 1, { status: opts.claimed ? "done" : "failed", toolsUsed: [], scratchpadKeys: [], stepsCount: 2, stepsByType: { action: 1 }, outputPreview: "x", outputLen: 1, messagesCount: 2, tokens: opts.tokens, cost: 0, llmCalls: 2, terminatedBy: opts.claimed ? "final_answer_tool" : undefined, pendingGuidance: undefined }));
  events.push(e("run-completed", -1, { status: opts.claimed ? "success" : "failure", totalTokens: opts.tokens, totalCostUsd: 0, durationMs: 100 }));
  return { runId: id, events };
}

describe("aggregateCohort", () => {
  it("computes honesty-aware cohort rates", () => {
    const c = aggregateCohort("arm", [
      run("a1", { tokens: 1000, deliverable: true, substantive: true, claimed: true }),
      run("a2", { tokens: 3000, deliverable: true, substantive: true, claimed: true }),
      run("a3", { tokens: 2000, deliverable: false, substantive: false, claimed: true }), // dishonest
    ]);
    expect(c.n).toBe(3);
    expect(c.claimedSuccessRate).toBeCloseTo(1.0);
    expect(c.dishonestSuspectedRate).toBeCloseTo(1 / 3);
    expect(c.deliverableProducedRate).toBeCloseTo(2 / 3);
    expect(c.tokensP50).toBe(2000);
  });
});

describe("compareCohorts — honesty gate is first-class", () => {
  const clean = aggregateCohort("thick", [
    run("t1", { tokens: 5000, deliverable: true, substantive: true, claimed: true }),
    run("t2", { tokens: 5000, deliverable: true, substantive: true, claimed: true }),
  ]);

  it("a token win bought by loosened honesty is a REGRESSION, not an improvement", () => {
    const cheaperButDishonest = aggregateCohort("thin", [
      run("n1", { tokens: 1000, deliverable: false, substantive: false, claimed: true }),
      run("n2", { tokens: 1000, deliverable: true, substantive: true, claimed: true }),
    ]);
    const d = compareCohorts(clean, cheaperButDishonest);
    expect(d.verdict).toBe("B regresses");
    expect(d.reasons.join(" ")).toContain("honesty REGRESSED");
  });

  it("cheaper at flat honesty = improvement", () => {
    const cheaperHonest = aggregateCohort("thin", [
      run("n1", { tokens: 2000, deliverable: true, substantive: true, claimed: true }),
      run("n2", { tokens: 2000, deliverable: true, substantive: true, claimed: true }),
    ]);
    const d = compareCohorts(clean, cheaperHonest);
    expect(d.verdict).toBe("B improves");
    expect(d.reasons.join(" ")).toContain("tokensP50 ↓");
  });

  it("success drop is a regression even if cheaper", () => {
    const cheaperButFails = aggregateCohort("thin", [
      run("n1", { tokens: 1000, deliverable: true, substantive: true, claimed: false }),
      run("n2", { tokens: 1000, deliverable: true, substantive: true, claimed: true }),
    ]);
    const d = compareCohorts(clean, cheaperButFails);
    expect(d.verdict).toBe("B regresses");
  });
});
