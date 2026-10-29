// Run: bun test packages/runtime/tests/subagent/runid-stamp.test.ts --timeout 15000
//
// D-2026-10-28-RUNID-STAMP: a delegated child stamps its OWN RunContext.runId on
// AgentStarted AND AgentCompleted, so makeRunTree links grandchildren exactly
// and same-name siblings are no longer ambiguous.
// RED-ON-CUT: drop the `runId` spread in engine/execute-agent-started.ts (or
// engine/finalize/run-finalize.ts) and the stamped-runId assertions fail.
import { describe, expect, it } from "bun:test";
import { makeRunTree } from "@reactive-agents/core";
import { ReactiveAgents } from "../../src/index.js";

type Ev = Record<string, unknown> & { _tag: string };

describe("AgentStarted/AgentCompleted carry the child's own runId", () => {
  it("same-name siblings get distinct, correctly-shaped runIds; the tree keys them exactly", async () => {
    const agent = await ReactiveAgents.create()
      .withName("runid-root")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withTestScenario([
        {
          match: "RUNID_ROOT",
          toolCall: {
            name: "spawn-agents",
            args: {
              tasks: [
                { task: "CHILDWORK one", name: "worker" },
                { task: "CHILDWORK two", name: "worker" },
              ],
            },
          },
        },
        { match: "CHILDWORK", text: "child done" },
        { text: "Done." },
      ])
      .build();
    const events: Ev[] = [];
    const unsub = await agent.subscribe(((e: Ev) => {
      if (e._tag === "AgentStarted" || e._tag === "AgentCompleted") events.push(e);
    }) as never);
    try {
      const rootTaskId = "runid-root-task";
      await agent.run("RUNID_ROOT: delegate twice.", { taskId: rootTaskId });
      const kids = events.filter((e) => e._tag === "AgentStarted" && e.agentDisplayName === "worker");
      expect(kids).toHaveLength(2);
      const runIds = kids.map((k) => k.runId as string);
      expect(runIds.every((r) => typeof r === "string" && /\.worker-[0-9a-f]{8}$/.test(r))).toBe(true);
      expect(new Set(runIds).size).toBe(2);
      for (const k of kids) {
        const done = events.find((e) => e._tag === "AgentCompleted" && e.taskId === k.taskId);
        expect(done?.runId).toBe(k.runId);
      }
      const tree = makeRunTree(rootTaskId);
      for (const e of events) tree.observe(e);
      expect(tree.nodes().map((n) => n.runId).sort()).toEqual([...runIds].sort());
    } finally {
      if (typeof unsub === "function") (unsub as () => void)();
      await agent.dispose();
    }
  }, 15000);
});
