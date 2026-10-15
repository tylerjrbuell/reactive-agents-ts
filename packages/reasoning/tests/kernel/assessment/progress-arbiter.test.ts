// Run: bun test packages/reasoning/tests/kernel/assessment/progress-arbiter.test.ts --timeout 15000
//
// W4.7 — design law #5: ONE progress arbiter. Pins the exact classification
// rules: a META / pseudo / no-op / failed tool result is NON-PROGRESS; only a
// successful, non-meta, evidence-bearing result is SUBSTANTIVE.
import { describe, expect, it } from "bun:test";
import {
  actionToolName,
  classifyActionStep,
  classifyOutput,
  classifyToolResult,
  contentIsNoOp,
  creditsEvidence,
  isMetaTool,
  isPseudoTool,
} from "../../../src/kernel/assessment/progress-arbiter.js";
import type { ReasoningStep } from "../../../src/types/index.js";

function action(tool: string, id: string): ReasoningStep {
  return {
    id: `a-${id}` as ReasoningStep["id"],
    type: "action",
    content: JSON.stringify({ tool, input: "{}" }),
    timestamp: new Date(),
    metadata: { toolCall: { id, name: tool } },
  };
}

describe("progress arbiter — classifyToolResult (law #5)", () => {
  it("a failed result is NON-PROGRESS", () => {
    expect(classifyToolResult("file-read", false, "boom").reason).toBe("failed");
  });

  it("a META tool result is NON-PROGRESS even with success:true and content", () => {
    expect(classifyToolResult("discover-tools", true, "Top 1 TOOLS matching …").reason).toBe("meta-tool");
    expect(classifyToolResult("recall", true, "some recalled fact").reason).toBe("meta-tool");
  });

  it("a HARNESS pseudo-tool result is NON-PROGRESS even with success:true", () => {
    expect(classifyToolResult("system", true, "quality nudge").reason).toBe("pseudo-tool");
    expect(isPseudoTool("completion-guard")).toBe(true);
  });

  it("a success-shaped no-op is NON-PROGRESS", () => {
    expect(classifyToolResult("http-get", true, "No tools registered.").reason).toBe("no-op");
    expect(classifyToolResult("http-get", true, "   ").reason).toBe("no-op");
    expect(classifyToolResult("http-get", true, undefined).reason).toBe("no-op");
  });

  it("a substantive non-meta result with content is SUBSTANTIVE", () => {
    const v = classifyToolResult("file-read", true, "Widget: 1200\nGadget: 800");
    expect(v.kind).toBe("substantive");
    expect(creditsEvidence("file-read", true, "Widget: 1200")).toBe(true);
  });

  it("contentIsNoOp is narrow — a real result that merely contains a word is not a no-op", () => {
    expect(contentIsNoOp("The model cannot find the file, but here is a report.")).toBe(false);
  });
});

describe("progress arbiter — classifyActionStep", () => {
  it("reads the action's tool name from toolCall metadata", () => {
    expect(actionToolName(action("web-search", "t1"))).toBe("web-search");
    expect(isMetaTool("discover-tools")).toBe(true);
  });

  it("a META action is NON-PROGRESS regardless of its observation", () => {
    const a = action("discover-tools", "t1");
    expect(classifyActionStep(a, { success: true, content: "ok" }).reason).toBe("meta-tool");
  });

  it("a non-meta action with no observation yet is SUBSTANTIVE (in-flight, not punished)", () => {
    expect(classifyActionStep(action("file-read", "t1"), undefined).kind).toBe("substantive");
  });

  it("a non-meta action whose observation failed is NON-PROGRESS", () => {
    expect(classifyActionStep(action("file-read", "t1"), { success: false, content: "err" }).reason).toBe("failed");
  });
});

describe("progress arbiter — classifyOutput (terminal honesty, mode 3)", () => {
  it("a give-up answer is NON-PROGRESS", () => {
    expect(classifyOutput("I'm unable to send a Slack message.").reason).toBe("give-up");
  });

  it("a real answer is SUBSTANTIVE", () => {
    expect(classifyOutput("## Summary\nWidget leads at 2100.").kind).toBe("substantive");
  });
});
