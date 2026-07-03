/**
 * TDD: terminate() aborts the in-flight LLM call on the run() path.
 *
 * The non-streaming run() path drives the engine via
 * `runtime.runPromise(buildRunTaskEffect(...))`. Before the fix that promise is
 * run WITHOUT the killswitch's AbortSignal, so terminate() only flips
 * killswitch state that is checked at the next phase boundary — an in-flight LLM
 * completion (Effect.sleep in the test provider; a real HTTP request under
 * Ollama) runs to completion first.
 *
 * With the fix the killswitch AbortSignal is threaded into runPromise, so
 * terminate() interrupts the fiber immediately and the in-flight completion is
 * cut. The test provider's `delayMs` uses interruptible `Effect.sleep`, giving a
 * real timing window that mirrors a slow provider.
 */
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

describe("terminate aborts in-flight run", () => {
  it("agent.terminate() interrupts the in-flight completion promptly", async () => {
    const agent = await ReactiveAgents.create()
      .withName("terminate-inflight")
      .withTestScenario([{ text: "slow response", delayMs: 1500 }])
      .withKillSwitch()
      .build();

    const start = Date.now();
    // run() rejects when the fiber is interrupted — swallow so we can time it.
    const runP = agent.run("test", { taskId: "t1" }).then(
      () => "resolved",
      () => "rejected",
    );

    // Terminate well before the 1500ms delay completes.
    const timer = setTimeout(() => {
      void agent.terminate("test terminate");
    }, 50);

    await runP;
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    await agent.dispose();

    // Must cut well before the 1500ms provider delay → abort actually worked.
    expect(elapsed).toBeLessThan(500);
  }, 10_000);

  it("without terminate the run completes after the delay (control)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("no-terminate")
      .withTestScenario([{ text: "done", delayMs: 100 }])
      .withKillSwitch()
      .build();

    const result = await agent.run("test", { taskId: "t2" });
    await agent.dispose();

    expect(result.success).toBe(true);
    expect(result.output).toContain("done");
  }, 10_000);

  it("emits AgentTerminated when terminate aborts an in-flight run", async () => {
    const agent = await ReactiveAgents.create()
      .withName("terminate-event")
      .withTestScenario([{ text: "slow", delayMs: 1500 }])
      .withKillSwitch()
      .build();

    const tags: string[] = [];
    await agent.subscribe((event) => {
      tags.push(event._tag);
    });

    const runP = agent.run("test", { taskId: "t3" }).catch(() => undefined);
    const timer = setTimeout(() => {
      void agent.terminate("test terminate");
    }, 50);
    await runP;
    clearTimeout(timer);
    // Give the fire-and-forget event publish a tick to land.
    await new Promise((r) => setTimeout(r, 20));
    await agent.dispose();

    expect(tags).toContain("AgentTerminated");
  }, 10_000);
});
