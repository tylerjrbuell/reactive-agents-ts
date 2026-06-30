// Run: bun test packages/runtime/tests/lifecycle-hook-firing.test.ts --timeout 15000
//
// Seals a real coverage gap: that lifecycle hooks registered via .withHook()
// actually FIRE through a real agent.run() at the runner's phase-hook site
// (runPhaseHooks). The other hook tests invoke the collected wrapper directly
// or test error propagation — none drives a real run, so a regression that
// stopped firing hooks (the fire site never wired) would have shipped green.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("lifecycle hooks fire through a real run", () => {
  it("invokes think:before and complete:after during a reasoning run", async () => {
    const fired = { thinkBefore: 0, completeAfter: 0 };
    const agent = await ReactiveAgents.create()
      .withName("hook-fire")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: done" }])
      .withReasoning()
      .withHook({ phase: "think", timing: "before", handler: () => { fired.thinkBefore++; } })
      .withHook({ phase: "complete", timing: "after", handler: () => { fired.completeAfter++; } })
      .build();

    const r = await agent.run("say done");

    expect(r.success).toBe(true);
    // Gut-check: gut the runPhaseHooks fire site → these go to 0 → RED.
    expect(fired.thinkBefore).toBeGreaterThan(0);
    expect(fired.completeAfter).toBeGreaterThan(0);
  });

  it("passes the live execution context to the handler (iteration is a number)", async () => {
    let seenIteration: unknown = "unset";
    const agent = await ReactiveAgents.create()
      .withName("hook-ctx")
      .withProvider("test")
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withReasoning()
      .withHook({
        phase: "think",
        timing: "before",
        handler: (ctx) => { seenIteration = (ctx as { iteration?: unknown }).iteration; },
      })
      .build();

    await agent.run("go");

    // The handler received a real ExecutionContext, not undefined.
    expect(typeof seenIteration).toBe("number");
  });
});
