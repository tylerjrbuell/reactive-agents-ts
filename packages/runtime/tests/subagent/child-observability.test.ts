// Run: bun test packages/runtime/tests/subagent/child-observability.test.ts --timeout 30000
//
// The G1 pin (audit gap G1): a delegated sub-agent's events must reach the
// PARENT's event bus, tagged with parentAgentId. Before the child-layer fix the
// child builds its OWN EventBus (createLightRuntime) and emits into a bus nobody
// is subscribed to, so a parent subscriber never sees the child. This test
// reproduces that bug (childEvents.length === 0) and pins the fix.
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../../src/index.js";

describe("sub-agent observability (G1)", () => {
  it("child agent events arrive on the PARENT's event bus, tagged with parentAgentId", async () => {
    const events: Array<{ tag: string; agentId: string; parentAgentId?: string }> = [];

    const parent = await ReactiveAgents.create()
      .withName("g1-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "research the topic", name: "researcher" } } },
        { text: "Done." },
      ])
      .build();

    await parent.subscribe((e: AgentEvent) => {
      const withParent = e as AgentEvent & { parentAgentId?: string };
      events.push({
        tag: e._tag,
        agentId: (e as AgentEvent & { agentId?: string }).agentId ?? "",
        parentAgentId: withParent.parentAgentId,
      });
    });

    await parent.run("Delegate a research task to a sub-agent.");
    await parent.dispose();

    const childEvents = events.filter((e) => e.parentAgentId !== undefined);
    expect(childEvents.length).toBeGreaterThan(0);
    expect(childEvents[0]!.parentAgentId).toContain("g1-parent");
  }, 30000);
});
