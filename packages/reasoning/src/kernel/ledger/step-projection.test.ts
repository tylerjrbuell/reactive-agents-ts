/**
 * step-projection.test.ts — the dual-emit derivation (Wave C / task C1).
 *
 * The RunLedger is GROWN FROM steps[]: every step writer's new steps derive the
 * matching ledger entry. This pins the step-type → ledger-kind mapping used by
 * the `transitionState` chokepoint so the "steps ≡ legacy AND ledger has
 * corresponding entries" property holds structurally.
 */
import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../types/index.js";
import type { StepId } from "../../types/step.js";
import { entriesOfKind } from "./run-ledger.js";
import { projectStepsToLedger } from "./step-projection.js";

function step(
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  return {
    id: ulid() as StepId,
    type,
    content,
    timestamp: new Date(),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

describe("step-projection — steps[] → ledger dual-emit", () => {
  it("maps action → tool-invocation with toolName/args/ids", () => {
    const s = step("action", 'web-search({"q":"x"})', {
      toolCall: { id: "call_1", name: "web-search", arguments: { q: "x" } },
      toolCallId: "call_1",
    });
    const ledger = projectStepsToLedger([], [s], 2);
    const inv = entriesOfKind(ledger, "tool-invocation");
    expect(inv.length).toBe(1);
    expect(inv[0]?.toolName).toBe("web-search");
    expect(inv[0]?.args).toEqual({ q: "x" });
    expect(inv[0]?.toolCallId).toBe("call_1");
    expect(inv[0]?.stepId).toBe(s.id);
    expect(inv[0]?.iteration).toBe(2);
  });

  it("falls back to parsing the tool name from action content", () => {
    const ledger = projectStepsToLedger([], [step("action", "http-get({...})")], 0);
    expect(entriesOfKind(ledger, "tool-invocation")[0]?.toolName).toBe("http-get");
  });

  it("maps observation → tool-result carrying success/preview/refs", () => {
    const s = step("observation", "the result body", {
      observationResult: {
        success: true,
        toolName: "web-search",
        displayText: "the result body",
        category: "web-search",
        resultKind: "data",
        preserveOnCompaction: false,
        trustLevel: "untrusted",
      },
      storedKey: "_tool_result_1",
      extractedFact: "key fact",
    });
    const ledger = projectStepsToLedger([], [s], 1);
    const res = entriesOfKind(ledger, "tool-result");
    expect(res.length).toBe(1);
    expect(res[0]?.success).toBe(true);
    expect(res[0]?.toolName).toBe("web-search");
    expect(res[0]?.preview).toContain("the result body");
    expect(res[0]?.storedKey).toBe("_tool_result_1");
    expect(res[0]?.extractedFact).toBe("key fact");
  });

  it("emits a per-step verdict when an observation carries verification (audit 01)", () => {
    const s = step("observation", "answer", {
      verification: { verified: false, summary: "ungrounded figure" },
    });
    const ledger = projectStepsToLedger([], [s], 4);
    const verdicts = entriesOfKind(ledger, "verdict");
    expect(verdicts.length).toBe(1);
    expect(verdicts[0]?.verified).toBe(false);
    expect(verdicts[0]?.gate).toBe("per-step");
    expect(verdicts[0]?.reason).toBe("ungrounded figure");
    // the observation ALSO produced its tool-result entry
    expect(entriesOfKind(ledger, "tool-result").length).toBe(1);
  });

  it("maps harness_signal → harness-signal", () => {
    const ledger = projectStepsToLedger([], [step("harness_signal", "⚠️ redirect")], 3);
    const sig = entriesOfKind(ledger, "harness-signal");
    expect(sig.length).toBe(1);
    expect(sig[0]?.signal).toBe("⚠️ redirect");
  });

  it("skips thought/plan/reflection/critique (ledger is the high-value subset)", () => {
    const ledger = projectStepsToLedger(
      [],
      [step("thought", "t"), step("plan", "p"), step("reflection", "r"), step("critique", "c")],
      0,
    );
    expect(ledger.length).toBe(0);
  });

  it("continues seq numbering from the base ledger", () => {
    const base = projectStepsToLedger([], [step("harness_signal", "a")], 0);
    const grown = projectStepsToLedger(base, [step("harness_signal", "b")], 1);
    expect(grown.map((e) => e.seq)).toEqual([0, 1]);
  });
});
