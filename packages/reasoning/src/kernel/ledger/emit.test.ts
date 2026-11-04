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
import { appendEntry, entriesOfKind } from "./run-ledger.js";
import {
  recordSubKernelSteps,
  recordEvidenceClaims,
  recordTerminalVerdict,
  recordCompactionMarker,
  recordCompactionNoShrink,
} from "./emit.js";

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

describe("recordCompactionMarker — dropped refs are a fact, not a lie (audit 03-F4)", () => {
  it("records a compaction-marker enumerating the dropped refs", () => {
    const ledger = recordCompactionMarker([], ["_tool_result_1", "_tool_result_2"], 5, "overflow");
    const markers = entriesOfKind(ledger, "compaction-marker");
    expect(markers.length).toBe(1);
    expect(markers[0]!.droppedRefs).toEqual(["_tool_result_1", "_tool_result_2"]);
    expect(markers[0]!.iteration).toBe(5);
    expect(markers[0]!.reason).toBe("overflow");
  });

  it("no-op when nothing was dropped", () => {
    const ledger = recordCompactionMarker([], [], 5);
    expect(entriesOfKind(ledger, "compaction-marker").length).toBe(0);
  });

  it("de-dups an identical dropped-ref set (compaction re-runs every over-budget iter)", () => {
    let ledger = recordCompactionMarker([], ["_tool_result_1"], 5);
    ledger = recordCompactionMarker(ledger, ["_tool_result_1"], 6); // same set → no new marker
    expect(entriesOfKind(ledger, "compaction-marker").length).toBe(1);
    ledger = recordCompactionMarker(ledger, ["_tool_result_1", "_tool_result_2"], 7); // changed → new
    expect(entriesOfKind(ledger, "compaction-marker").length).toBe(2);
  });
});

describe("recordSubKernelSteps — a sub-kernel's tool calls reach the parent ledger (D9)", () => {
  it("projects an action + observation onto a non-empty parent ledger with dense, continuing seq", () => {
    let parent = appendEntry([], {
      kind: "harness-signal",
      iteration: 0,
      signal: "parent-fact-0",
    });
    parent = appendEntry(parent, {
      kind: "harness-signal",
      iteration: 0,
      signal: "parent-fact-1",
    });
    const action: ReasoningStep = {
      id: ulid() as StepId,
      type: "action",
      content: "file-write(...)",
      timestamp: new Date(),
      metadata: {
        toolCall: { id: "call-1", name: "file-write", arguments: { path: "out.md", content: "x" } },
      },
    };
    const observation = obs("wrote out.md", "file-write");

    const grown = recordSubKernelSteps(parent, [action, observation], 3);

    expect(grown.length).toBe(4);
    expect(grown.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    const [inv] = entriesOfKind(grown, "tool-invocation");
    const [res] = entriesOfKind(grown, "tool-result");
    expect(inv?.toolName).toBe("file-write");
    expect(inv?.args).toEqual({ path: "out.md", content: "x" });
    expect(inv?.iteration).toBe(3);
    expect(res?.toolName).toBe("file-write");
    expect(res?.success).toBe(true);
    expect(res?.iteration).toBe(3);
    // Parent's prior entries untouched, in order.
    expect(grown.slice(0, 2)).toEqual([...parent]);
  });
});

describe("recordCompactionNoShrink — the shrink self-check never silent (C4)", () => {
  it("records a harness-signal when compaction could not shrink", () => {
    const ledger = recordCompactionNoShrink([], 9);
    const signals = entriesOfKind(ledger, "harness-signal");
    expect(signals.length).toBe(1);
    expect(signals[0]!.signal).toBe("compaction-no-shrink");
  });

  it("records the no-shrink signal once, not every iteration", () => {
    let ledger = recordCompactionNoShrink([], 9);
    ledger = recordCompactionNoShrink(ledger, 10);
    expect(entriesOfKind(ledger, "harness-signal").filter((s) => s.signal === "compaction-no-shrink").length).toBe(1);
  });
});
