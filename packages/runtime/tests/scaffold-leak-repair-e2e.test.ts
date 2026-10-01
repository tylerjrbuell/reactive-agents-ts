// Run: bun test packages/runtime/tests/scaffold-leak-repair-e2e.test.ts --timeout 20000
//
// End-to-end reproduction of the reported incident (taskId
// 01M3T04DXBYSYMXTRPSH57AT93):
//
//   error: Verifier rejected output: final-answer: failed at scaffold-leak
//   (output contains framework scaffolding markers ...), Execution failed
//   at phase "execution"
//     at packages/runtime/src/reactive-agent.ts:1175
//
// The model's terminal answer echoed harness scaffolding instead of the
// tool data; the always-on guard rejected it and the run HARD-FAILED with
// zero repair attempts, surfacing through the builder boundary as a failed
// run (or, on a bare builder whose termination is in BARE_BUILDER_THROWS_ON,
// the thrown ExecutionError above).
//
// Contract verified here, at the public `agent.run()` boundary:
//   1. A leaked terminal answer gets ONE corrective synthesis pass; when the
//      repair is clean, the run SHIPS the repaired answer (success, no throw).
//   2. When the repair still leaks, the guard's honest hard-fail remains -
//      the scaffold-leak reason surfaces, a scaffolding dump never ships.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

const LEAKED_ANSWER =
  "The data is in _tool_result_1, full text is stored, use recall(\"_tool_result_1\") to read it.";

describe("scaffold-leak terminal repair at the agent.run() boundary", () => {
  it("a leaked terminal answer is repaired and the run succeeds", async () => {
    const agent = await ReactiveAgents.create()
      .withName("scaffold-leak-repair-e2e")
      .withProvider("test")
      .withTestScenario([
        { text: LEAKED_ANSWER }, // agent channel: the leaking final answer
        { text: "The answer is: 42." }, // harness channel: the repair pass
      ])
      .build();
    try {
      const r = await agent.run("What is the answer to everything?");
      expect(r.success).toBe(true);
      expect(r.output).toBe("The answer is: 42.");
      expect(String(r.output ?? "")).not.toContain("_tool_result_");
    } finally {
      await agent.dispose();
    }
  }, 30000);

  it("a still-leaking repair keeps the honest failure with the scaffold-leak reason", async () => {
    // Single repeating scenario: the repair pass echoes scaffolding too -
    // bounded at ONE attempt, the run must fail with the specific reason.
    const agent = await ReactiveAgents.create()
      .withName("scaffold-leak-repair-e2e-still-leaking")
      .withProvider("test")
      .withTestScenario([{ text: LEAKED_ANSWER }])
      .build();
    try {
      const r = await agent.run("What is the answer to everything?");
      expect(r.success).toBe(false);
      const surfaced = `${String(r.error ?? "")} ${String(
        (r.metadata as { verificationWarning?: string } | undefined)?.verificationWarning ?? "",
      )}`;
      expect(surfaced).toContain("scaffold-leak");
      // The receipt verdict is CAPPED, a still-leaking answer is never
      // recorded as grounded/successful. (Per the HS-237 contract, the
      // rejected text itself deliberately survives on the FAILED result so
      // the boundary verifier can re-derive and label the rejection reason
      //, see result-boundary-verification.test.ts. `success: false` above
      // is what guarantees it is never shipped as an answer.)
      expect(r.receipt?.verifierVerdict).toBe("reject");
    } catch (e) {
      // Bare-builder throw contract for kernel failures, the thrown error
      // must still carry the specific scaffold-leak reason, not a generic one.
      expect(String((e as Error).message)).toContain("scaffold-leak");
    } finally {
      await agent.dispose();
    }
  }, 30000);
});
