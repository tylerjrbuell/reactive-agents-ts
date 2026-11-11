/**
 * agent.stop() is honoured INSIDE the reasoning phase, not only between
 * engine phases.
 *
 * The whole reasoning loop runs as one guarded "think" phase, so a stop()
 * signal used to wait for the loop to finish (every model call and every
 * kernel iteration) before the next phase-boundary lifecycle check saw it.
 * Callers had to escalate to terminate() after a grace period.
 *
 * Also pinned: a caller that disposes right after `await agent.terminate()`
 * still observes AgentTerminated (exactly once), because the event is
 * published while terminate() runs, not after the run's rejection settles
 * on a runtime that may already be disposed.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { STOP_POLL_MS } from "../src/engine/execute-lifecycle-guard.js";

/** Generous ceiling over STOP_POLL_MS: poll + interrupt + phase/test overhead. */
const STOP_BOUND_MS = 1_000;

const echoTool = {
  definition: {
    name: "echo-tool",
    description: "Echo input",
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args["input"])}`),
};

describe("agent.stop() mid-loop", () => {
  it("ends a run blocked in a long model call promptly, as stopped", async () => {
    const agent = await ReactiveAgents.create()
      .withName("stop-mid-call")
      .withTestScenario([{ text: "slow response", delayMs: 4_000 }])
      .withKillSwitch()
      .build();

    const tags: string[] = [];
    await agent.subscribe((event) => {
      tags.push(event._tag);
    });

    const start = Date.now();
    const runP = agent.run("test", { taskId: "stop-1" }).then(
      () => ({ ok: true as const, message: "" }),
      (e: unknown) => ({ ok: false as const, message: String((e as { message?: unknown } | null)?.message ?? e) }),
    );
    const timer = setTimeout(() => {
      void agent.stop("user stop");
    }, 100);

    const outcome = await runP;
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    await agent.dispose();

    expect(elapsed).toBeLessThan(STOP_BOUND_MS);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("stop() requested");
    expect(tags).toContain("AgentStopped");
    expect(tags).not.toContain("AgentTerminated");
  }, 15_000);

  it("ends a run across many slow kernel iterations promptly", async () => {
    // Tool-calling iterations of 700ms each (distinct args so no repetition
    // guard ends the loop early). stop() lands during the SECOND model call,
    // after one full iteration; without the fix the loop runs on until a
    // progress guard ends it (~4 iterations, ~2.8s).
    const turns = Array.from({ length: 10 }, (_, i) => ({
      toolCall: { name: "echo-tool", args: { input: `step-${i}` } },
      delayMs: 700,
    }));
    const agent = await ReactiveAgents.create()
      .withName("stop-mid-iterations")
      .withTestScenario([...turns, { text: "FINAL ANSWER: done" }] as never)
      .withTools({ tools: [echoTool] })
      .withReasoning()
      .withMaxIterations(12)
      .withKillSwitch()
      .build();

    // Stop right after the first iteration's tool call completes, so the
    // stop lands between iterations / in the second model call regardless
    // of machine load.
    let stoppedAt = 0;
    await agent.subscribe((event) => {
      if (event._tag === "ToolCallCompleted" && stoppedAt === 0) {
        stoppedAt = Date.now();
        void agent.stop("user stop");
      }
    });

    const outcome = await agent.run("test", { taskId: "stop-2" }).then(
      () => "resolved",
      () => "rejected",
    );
    const sinceStop = Date.now() - stoppedAt;
    await agent.dispose();

    // Non-vacuity: the stop landed after one full iteration.
    expect(stoppedAt).toBeGreaterThan(0);
    expect(outcome).toBe("rejected");
    expect(sinceStop).toBeLessThan(STOP_BOUND_MS);
  }, 15_000);

  it("polls at a documented, small interval", () => {
    expect(STOP_POLL_MS).toBeGreaterThan(0);
    expect(STOP_POLL_MS).toBeLessThanOrEqual(250);
  });
});

describe("terminate() then immediate dispose()", () => {
  it("still publishes AgentTerminated exactly once", async () => {
    const agent = await ReactiveAgents.create()
      .withName("terminate-dispose")
      .withTestScenario([{ text: "slow", delayMs: 4_000 }])
      .withKillSwitch()
      .build();

    const terminated: string[] = [];
    await agent.subscribe((event) => {
      if (event._tag === "AgentTerminated") terminated.push(event.taskId);
    });

    const runP = agent.run("test", { taskId: "term-1" }).then(
      () => "resolved",
      () => "rejected",
    );
    await new Promise((r) => setTimeout(r, 100));
    await agent.terminate("shutdown");
    const seenWhenTerminateResolved = [...terminated];
    await agent.dispose();
    const outcome = await runP;

    expect(seenWhenTerminateResolved).toEqual(["term-1"]);

    expect(outcome).toBe("rejected");
    expect(terminated).toEqual(["term-1"]);
  }, 15_000);

  it("publishes AgentTerminated once when the runtime outlives the run", async () => {
    const agent = await ReactiveAgents.create()
      .withName("terminate-once")
      .withTestScenario([{ text: "slow", delayMs: 4_000 }])
      .withKillSwitch()
      .build();

    const terminated: string[] = [];
    await agent.subscribe((event) => {
      if (event._tag === "AgentTerminated") terminated.push(event.taskId);
    });

    const runP = agent.run("test", { taskId: "term-2" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    await agent.terminate("shutdown");
    await runP;
    await new Promise((r) => setTimeout(r, 20));
    await agent.dispose();

    expect(terminated).toEqual(["term-2"]);
  }, 15_000);
});
