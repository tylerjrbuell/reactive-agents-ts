// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/loop-detector-arbiter.test.ts --timeout 15000
//
// W4.7 — the loop detector routed through the ONE progress arbiter (design law
// #5). The frozen-baseline thrash shape (varied args, success:true, zero new
// evidence) must now trip (d)/(c); a SUBSTANTIVE tool returning new evidence must
// NOT trip (false-positive guard). Pattern (e) fires on sustained evidenceDelta 0.
import { describe, expect, it } from "bun:test";
import { detectLoop } from "../../../../src/kernel/capabilities/reflect/loop-detector.js";
import type { ReasoningStep } from "../../../../src/types/index.js";

let n = 0;
function act(tool: string, args: Record<string, unknown>, id: string): ReasoningStep {
  return {
    id: `a-${n++}` as ReasoningStep["id"],
    type: "action",
    content: JSON.stringify({ tool, input: JSON.stringify(args) }),
    timestamp: new Date(),
    metadata: { toolCall: { id, name: tool, arguments: args } },
  };
}
function obs(success: boolean, toolCallId: string, content: string): ReasoningStep {
  return {
    id: `o-${n++}` as ReasoningStep["id"],
    type: "observation",
    content,
    timestamp: new Date(),
    metadata: { toolCallId, observationResult: { success, toolName: "x" } },
  };
}
function thought(text: string): ReasoningStep {
  return { id: `t-${n++}` as ReasoningStep["id"], type: "thought", content: text, timestamp: new Date() };
}

// maxSameTool=2 (local tier) so pattern (a) never fires on VARIED args; (d) floor
// is max(2,3)=3. maxConsecutiveThoughts high so (c) does not pre-empt these.
const A = 2, RT = 5, CT = 10;

describe("detectLoop × arbiter — meta thrash trips (d) (W4.7)", () => {
  it("3 same-name META calls, VARIED args, all success:true → trips (the frozen-thrash shape)", () => {
    const steps = [
      act("discover-tools", { query: "read file" }, "t1"), obs(true, "t1", "Top 1 TOOLS matching …"),
      act("discover-tools", { query: "write file" }, "t2"), obs(true, "t2", "Top 1 TOOLS matching …"),
      act("discover-tools", { query: "list files" }, "t3"), obs(true, "t3", "Top 1 TOOLS matching …"),
    ];
    const msg = detectLoop(steps, A, RT, CT);
    expect(msg).not.toBeNull();
    expect(msg).toContain("discover-tools");
  }, 15000);

  it("interleaved thoughts + same-name META no-op actions → trips (d) (meta is not progress)", () => {
    const steps = [
      thought("let me find a tool"),
      act("discover-tools", { query: "read" }, "t1"), obs(true, "t1", "Top 1 TOOLS matching …"),
      thought("still looking"),
      act("discover-tools", { query: "write" }, "t2"), obs(true, "t2", "Top 1 TOOLS matching …"),
      thought("hmm"),
      act("discover-tools", { query: "list" }, "t3"), obs(true, "t3", "Top 1 TOOLS matching …"),
      thought("let me try again"),
    ];
    const msg = detectLoop(steps, A, RT, 3);
    expect(msg).not.toBeNull();
    expect(msg).toContain("discover-tools");
  }, 15000);
});

describe("detectLoop × arbiter — FALSE-POSITIVE GUARD", () => {
  it("3 same-name SUBSTANTIVE calls with new evidence → does NOT trip", () => {
    const steps = [
      act("file-read", { path: "./a" }, "t1"), obs(true, "t1", "Widget: 1200"),
      act("file-read", { path: "./b" }, "t2"), obs(true, "t2", "Gadget: 800"),
      act("file-read", { path: "./c" }, "t3"), obs(true, "t3", "Gizmo: 500"),
    ];
    expect(detectLoop(steps, A, RT, CT)).toBeNull();
  }, 15000);

  it("a substantive action resets the consecutive-thought streak (interrupts stall)", () => {
    const steps = [
      thought("a"), thought("b"),
      act("file-read", { path: "./a" }, "t1"), obs(true, "t1", "real content"),
      thought("c"), thought("d"),
    ];
    expect(detectLoop(steps, A, RT, 3)).toBeNull();
  }, 15000);
});

describe("detectLoop — pattern (e) evidence staleness (W4.1)", () => {
  it("fires at the threshold regardless of tool variety/args", () => {
    const steps = [act("discover-tools", { query: "read file" }, "t1")];
    const msg = detectLoop(steps, A, RT, CT, { evidenceStaleIterations: 3 });
    expect(msg).not.toBeNull();
    expect(msg).toContain("no new task evidence");
  }, 15000);

  it("does NOT fire below the threshold", () => {
    const steps = [act("discover-tools", { query: "read file" }, "t1")];
    expect(detectLoop(steps, A, RT, CT, { evidenceStaleIterations: 2 })).toBeNull();
  }, 15000);

  it("stays silent when the counter is absent (opts omitted → legacy path)", () => {
    expect(detectLoop([], A, RT, CT)).toBeNull();
  }, 15000);

  it("stays silent when no tool call was ever attempted (thought-stall is (c)'s job)", () => {
    const steps = [thought("just thinking")];
    expect(detectLoop(steps, A, RT, CT, { evidenceStaleIterations: 5 })).toBeNull();
  }, 15000);
});
