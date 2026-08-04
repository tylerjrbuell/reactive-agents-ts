// Run: bun test packages/reasoning/tests/kernel/capabilities/reflect/loop-detector-no-evidence.test.ts --timeout 15000
//
// Move 5 — the "no-new-evidence" loop signal (pattern d). detectLoop() must trip
// when the same tool is called N times (args may VARY) with no successful
// observation among them — the thrash that the byte-identical pattern (a) misses
// and that otherwise burns to maxIterations.
import { describe, it, expect } from "bun:test";
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
function obs(success: boolean, toolCallId: string): ReasoningStep {
  return {
    id: `o-${n++}` as ReasoningStep["id"],
    type: "observation",
    content: success ? "ok" : "error",
    timestamp: new Date(),
    metadata: { toolCallId, observationResult: { success, toolName: "x" } },
  };
}

// maxSameTool=5 (frontier) so pattern (a) never fires in these cases; the
// no-evidence floor is max(maxSameTool,3). Use maxSameTool=2 to test the floor.
const A = 2, RT = 3, CT = 4;

describe("detectLoop — no-new-evidence (pattern d)", () => {
  it("fires: 3 same-tool calls with VARIED args, all failing", () => {
    const steps = [
      act("file-read", { path: "./a" }, "t1"), obs(false, "t1"),
      act("file-read", { path: "./b" }, "t2"), obs(false, "t2"),
      act("file-read", { path: "./c" }, "t3"), obs(false, "t3"),
    ];
    const msg = detectLoop(steps, A, RT, CT);
    expect(msg).not.toBeNull();
    expect(msg).toContain("file-read");
    expect(msg).toContain("no successful result");
  }, 15000);

  it("does NOT fire when one of the recent calls SUCCEEDED (progress)", () => {
    const steps = [
      act("file-read", { path: "./a" }, "t1"), obs(false, "t1"),
      act("file-read", { path: "./b" }, "t2"), obs(true, "t2"), // progress
      act("file-read", { path: "./c" }, "t3"), obs(false, "t3"),
    ];
    expect(detectLoop(steps, A, RT, CT)).toBeNull();
  }, 15000);

  it("does NOT fire when the recent calls are DIFFERENT tools", () => {
    const steps = [
      act("file-read", { path: "./a" }, "t1"), obs(false, "t1"),
      act("web-search", { q: "b" }, "t2"), obs(false, "t2"),
      act("file-read", { path: "./c" }, "t3"), obs(false, "t3"),
    ];
    expect(detectLoop(steps, A, RT, CT)).toBeNull();
  }, 15000);

  it("does NOT fire below the floor of 3 (single legitimate retry)", () => {
    const steps = [
      act("file-read", { path: "./a" }, "t1"), obs(false, "t1"),
      act("file-read", { path: "./b" }, "t2"), obs(false, "t2"),
    ];
    expect(detectLoop(steps, A, RT, CT)).toBeNull();
  }, 15000);

  it("still fires pattern (a) on byte-identical repeats (unchanged)", () => {
    const steps = [
      act("file-read", { path: "./same" }, "t1"),
      act("file-read", { path: "./same" }, "t2"),
    ];
    // maxSameTool=2 → identical content twice trips (a) regardless of observations
    expect(detectLoop(steps, 2, RT, CT)).toContain("repeated");
  }, 15000);
});
