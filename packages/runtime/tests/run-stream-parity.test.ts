// Run: bun test packages/runtime/tests/run-stream-parity.test.ts
//
// FM-4 part 1 regression harness — run() and runStream() now both call the
// single shared `deriveTaskOutcome` (engine/finalize/derive-outcome.ts) so
// they cannot silently disagree about the terminal outcome of the same
// scenario. `StreamCompletedEvent` (stream-types.ts) does not currently
// expose top-level `terminatedBy`/`goalAchieved` fields the way `AgentResult`
// does — that gap is a separate, pre-existing issue (see task-1-report.md),
// not something this task's extraction changes. `receipt.terminatedBy` IS on
// both paths (computeTrustReceipt spreads it onto TrustReceipt), and
// `receipt.verdict` is itself a function of the shared `goalAchieved`
// computation (three of its branches key on it — see receipt.ts), so
// comparing `receipt.terminatedBy` / `receipt.verdict` pins the same shared
// computation this task unified.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("run/stream terminal-outcome parity", () => {
  it("run() and runStream() agree on receipt.terminatedBy and receipt.verdict for the same scenario", async () => {
    const scenario = [{ text: "FINAL ANSWER: 4" }];

    const runAgent = await ReactiveAgents.create().withProvider("test").withTestScenario(scenario).build();
    const streamAgent = await ReactiveAgents.create().withProvider("test").withTestScenario(scenario).build();
    try {
      const runResult = await runAgent.run("What is 2 + 2?");

      let streamReceipt: { terminatedBy?: string; verdict?: string } | undefined;
      for await (const event of streamAgent.runStream("What is 2 + 2?")) {
        if (event._tag === "StreamCompleted") {
          streamReceipt = event.receipt;
        }
      }

      expect(streamReceipt?.terminatedBy).toBe(runResult.terminatedBy);
      expect(streamReceipt?.verdict).toBe(runResult.receipt?.verdict);
    } finally {
      await runAgent.dispose();
      await streamAgent.dispose();
    }
  }, 20000);
});
