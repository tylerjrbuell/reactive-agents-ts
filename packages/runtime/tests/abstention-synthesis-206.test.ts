// Run: bun test packages/runtime/tests/abstention-synthesis-206.test.ts --timeout 20000
//
// GH #206: end-to-end: a budget-exhausted run with no valid answer ships a
// deterministic honest abstention instead of empty output. `success` stays
// false (this is not a success claim), and the message names what was
// attempted.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("GH #206: honest abstention on budget exhaustion", () => {
  it("ships an abstention (not empty output) when the loop exhausts with no answer", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abstention-206-empty-loop")
      .withTestScenario([{ text: "" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 8, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Test task");

    expect(result.success).toBe(false);
    expect(typeof result.output).toBe("string");
    expect(result.output.length).toBeGreaterThan(0);
    expect(result.output).toContain("Could not complete the task within the available budget.");
    await agent.dispose();
  }, 20000);

  it("ships an abstention when the model ends its turn on a rejected continuation", async () => {
    const agent = await ReactiveAgents.create()
      .withName("abstention-206-continuation")
      .withTestScenario([{ text: "I'll make one more attempt with a different search query:" }])
      .withReasoning({ strategies: { reactive: { maxIterations: 6, temperature: 0.7 } } })
      .build();

    const result = await agent.run("Find the current Bitcoin price.");

    expect(result.success).toBe(false);
    // The rejected continuation itself must never ship as the answer.
    expect(result.output).not.toContain("one more attempt");
    expect(result.output).toContain("Could not complete the task within the available budget.");
    await agent.dispose();
  }, 20000);
});
