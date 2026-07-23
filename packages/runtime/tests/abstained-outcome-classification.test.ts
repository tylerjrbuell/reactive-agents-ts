// Run: bun test packages/runtime/tests/abstained-outcome-classification.test.ts
//
// DEBT-REGISTER §3 (2026-07-23) — an honest abstention was being recorded as a
// SUCCESS in three places.
//
// `terminatedBy` was declared as a hand-written 5-value union at four sites
// (debrief, telemetry-emit, local-learning, debrief-synthesis) that omitted
// "abstained". The runtime string reached those sites regardless — the type just
// told the code a case it had to handle could not occur. Every one of them
// classified an abstention by falling through to the clean-termination branch:
//
//   - `deriveOutcome`   (debrief.ts)        → AgentDebrief.outcome = "success"
//   - telemetry RunReport                    → outcome = "success"
//   - `onRunCompleted`  (local-learning)     → learning outcome = "success"
//   - `recordOutcome`   (local-learning)     → skill CREDITED for the decline
//
// The last one is the worst: the procedural-memory loop was reinforcing whatever
// skill led the agent to decline to answer.
//
// RED-ON-CUT: delete the `abstained` branch in `deriveRunOutcome`
// (engine/util.ts) or in `deriveOutcome` (debrief.ts) and these fail.
import { describe, it, expect } from "bun:test";
import { deriveRunOutcome } from "../src/engine/util.js";
import { buildFallbackDebrief } from "../src/debrief.js";

describe("an abstained run is never classified as a success", () => {
  it("deriveRunOutcome maps abstained to failure, not success", () => {
    // No loop errors — this is precisely the shape that used to fall through to
    // "success": the run terminated cleanly, it just declined to answer.
    expect(deriveRunOutcome("abstained", false)).toBe("failure");
    expect(deriveRunOutcome("abstained", true)).toBe("failure");
  });

  it("preserves the prior classification for every non-abstained terminal", () => {
    // The extraction must be behavior-preserving for runs that never abstain,
    // so this pins the original ternary's full truth table.
    expect(deriveRunOutcome("max_iterations", false)).toBe("partial");
    expect(deriveRunOutcome("max_iterations", true)).toBe("partial");
    expect(deriveRunOutcome("final_answer", false)).toBe("success");
    expect(deriveRunOutcome("final_answer_tool", false)).toBe("success");
    // A final answer WITH loop errors still counts as success — the agent
    // recovered and delivered.
    expect(deriveRunOutcome("final_answer", true)).toBe("success");
    expect(deriveRunOutcome("final_answer_tool", true)).toBe("success");
    expect(deriveRunOutcome("end_turn", false)).toBe("success");
    expect(deriveRunOutcome("end_turn", true)).toBe("failure");
    expect(deriveRunOutcome("llm_error", true)).toBe("failure");
    // Pre-existing quirk, deliberately preserved rather than fixed inside an
    // unrelated extraction (see deriveRunOutcome's NOTE): an llm_error with no
    // collected loop errors still lands on "success". Pinned so that if someone
    // does fix it, they do so knowingly and update this line.
    expect(deriveRunOutcome("llm_error", false)).toBe("success");
  });

  it("the debrief reports an abstained run as failed, not success", () => {
    const debrief = buildFallbackDebrief({
      taskPrompt: "What is the population of Aetheria?",
      agentId: "agent-1",
      taskId: "task-1",
      terminatedBy: "abstained",
      toolCallHistory: [],
      errorsFromLoop: [],
      metrics: { tokens: 10, duration: 5, iterations: 1, cost: 0 },
    });

    // Was "success" before the fix — the debrief record told the user, and the
    // debrief store, that a run which delivered nothing had succeeded.
    expect(debrief.outcome).toBe("failed");
  });

  it("still reports a clean answered run as success", () => {
    const debrief = buildFallbackDebrief({
      taskPrompt: "What is 2+2?",
      agentId: "agent-1",
      taskId: "task-2",
      terminatedBy: "final_answer",
      toolCallHistory: [],
      errorsFromLoop: [],
      metrics: { tokens: 10, duration: 5, iterations: 1, cost: 0 },
    });

    expect(debrief.outcome).toBe("success");
  });
});
