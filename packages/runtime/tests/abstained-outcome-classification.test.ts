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

  it("a clean, error-free finish is still a success (the abstention fix changed nothing here)", () => {
    // This cell used to carry the classifier's FULL truth table, to prove the
    // abstention extraction was behavior-preserving. That table now lives in
    // `run-outcome-one-classifier.test.ts`, which pins the engine and debrief
    // lanes against each other — keeping a second copy here would be the exact
    // duplication whose drift that file exists to prevent.
    //
    // What remains is what this file uniquely owns: abstention (below), plus a
    // spot-check that the ordinary clean path was never disturbed.
    expect(deriveRunOutcome("final_answer", false)).toBe("success");
    expect(deriveRunOutcome("final_answer_tool", false)).toBe("success");
    expect(deriveRunOutcome("end_turn", false)).toBe("success");
    expect(deriveRunOutcome("max_iterations", false)).toBe("partial");

    // DECLARED CHANGE (2026-07-27). Three cells moved when the engine and
    // debrief classifiers were unified pointwise-conservative — the old line
    // here asked whoever fixed the `llm_error` quirk to update it knowingly,
    // and this is that update. A provider failure is no longer a success even
    // when the loop collected no error strings, and an explicit finish WITH
    // errors is now "partial" rather than "success" (the agent recovered and
    // delivered — real, but not clean). Rationale + full table in
    // run-outcome-one-classifier.test.ts.
    expect(deriveRunOutcome("llm_error", false)).toBe("failure");
    expect(deriveRunOutcome("final_answer", true)).toBe("partial");
    expect(deriveRunOutcome("final_answer_tool", true)).toBe("partial");
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
