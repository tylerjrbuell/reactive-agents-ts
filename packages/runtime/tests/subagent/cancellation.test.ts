// Run: bun test packages/runtime/tests/subagent/cancellation.test.ts --timeout 30000
//
// B8-T4 pin: terminating the parent mid-sub-agent-run INTERRUPTS the in-flight
// child (no "child completed" after terminate). Before the fork rewrite, the
// child ran on a DETACHED root fiber (`await Effect.runPromise(subEffect)`) that
// the parent's interrupt could not reach — the orphan ran to completion.
//
// Mirrors the proven terminate-aborts-inflight.test.ts pattern: withKillSwitch()
// threads terminate()'s AbortSignal into the run fiber, so an interrupt reaches
// in-flight work. The child's LLM turn is an interruptible `Effect.sleep`
// (delayMs). A fixed child (forked in the parent's fiber tree) is interrupted; a
// detached orphan completes anyway.
//
// Red-on-cut: revert buildSubAgentTask's fork boundary to
// `Effect.runPromise(subEffect.pipe(Effect.provide(subRuntime)))` and this fails
// — the orphan emits AgentCompleted inside the observation window.
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../../src/index.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const waitFor = async (pred: () => boolean, timeoutMs = 5000): Promise<void> => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await sleep(10);
  }
};

describe("sub-agent cancellation (B8-T4)", () => {
  it("terminating the parent interrupts an in-flight sub-agent (no orphan completion)", async () => {
    let childStarted = false;
    let childCompleted = false;
    let childAgentId: string | undefined;

    const agent = await ReactiveAgents.create()
      .withName("cancel-parent")
      .withProvider("test")
      .withModel("test-model")
      .withKillSwitch()
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      // The child inherits this scenario; match guards keep the child on its own
      // (slow) turn instead of re-triggering the parent's spawn turn.
      .withTestScenario([
        {
          match: "PARENTMARK",
          toolCall: {
            name: "spawn-agent",
            args: {
              task: "SLOWCHILDTASK run the delayed work",
              name: "slowchild",
            },
          },
        },
        // The child's single LLM turn: an interruptible 800ms delay before it
        // would answer. In the parent's fiber tree, terminate cuts this sleep.
        { match: "SLOWCHILDTASK", text: "child finished", delayMs: 800 },
        { text: "parent done" },
      ])
      .build();

    // AgentStarted carries parentAgentId (⇒ it's a child) AND the child agentId.
    // AgentCompleted carries only agentId, so capture the child id at start and
    // match completion by it. This closure survives terminate().
    await agent.subscribe((e: AgentEvent) => {
      const rec = e as AgentEvent & {
        parentAgentId?: string;
        agentId?: string;
      };
      if (
        e._tag === "AgentStarted" &&
        rec.parentAgentId !== undefined &&
        rec.agentId
      ) {
        childStarted = true;
        childAgentId = rec.agentId;
      }
      if (
        (e._tag === "AgentCompleted" || e._tag === "TaskFailed") &&
        childAgentId !== undefined &&
        rec.agentId === childAgentId
      ) {
        childCompleted = true;
      }
    });

    const runP = agent
      .run("Delegate PARENTMARK work to a sub-agent.", { taskId: "cancel-1" })
      .then(
        () => undefined,
        () => undefined,
      );

    await waitFor(() => childStarted);
    // The child is now in-flight in its delay; hard-abort the parent.
    await agent.terminate("test cancellation");

    // Wait well past the child's 800ms delay: a fixed child stays interrupted;
    // an orphaned (detached) child completes inside this window.
    await sleep(1600);

    expect(childStarted).toBe(true);
    expect(childCompleted).toBe(false);

    await runP;
    await agent.dispose();
  }, 30000);
});
