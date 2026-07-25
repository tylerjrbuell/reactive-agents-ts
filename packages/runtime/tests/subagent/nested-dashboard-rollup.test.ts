// Run: bun test packages/runtime/tests/subagent/nested-dashboard-rollup.test.ts --timeout 30000
//
// End-to-end pin for the centerpiece defect this task fixes: a sub-agent
// printing its OWN "Agent Execution Summary" dashboard mid-stream, interrupting
// the parent's output. Exercises the FULL wiring chain through the real
// builder/runtime — not the individual pieces in isolation:
//
//   root createRuntime() mints ChildDashboardRegistry (Task 3 Step 7)
//     -> spawn-agent tool dispatches a real sub-agent (createLightRuntime,
//        emitConsole:false from Task 2)
//     -> sub-agent-executor.ts captures the child's DashboardData
//        (ObservabilityService.getDashboardData(), Task 1) and records it
//        into the SAME registry the root created
//     -> execution-engine.ts (root only, `!lp`) drains the registry and calls
//        obs.attachChildren() right before its own obs.flush()
//     -> console-exporter.ts renders exactly ONE "Agent Execution Summary"
//        box, with the child's data nested underneath a "Sub-agent: <name>"
//        heading (Task 3 Steps 1-4).
//
// If any link in that chain is broken (e.g. the registry is actually scoped
// per-agent instead of per-run, or the drain never runs), this test fails
// either by finding a SECOND "Agent Execution Summary" box (child printed its
// own — the original defect) or by finding ZERO/missing "Sub-agent:" text
// (rollup silently didn't happen).
import { describe, expect, it, afterEach } from "bun:test";
import { ReactiveAgents } from "../../src/index.js";

const realLog = console.log;
afterEach(() => {
  console.log = realLog;
});

describe("nested dashboard rollup (sub-agent dashboard prints once, at the root)", () => {
  it("prints exactly one dashboard box, with the sub-agent nested underneath it", async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const parent = await ReactiveAgents.create()
      .withName("rollup-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withObservability({ verbosity: "normal" })
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "find the current bitcoin price", name: "bitcoin-price-finder" } } },
        { text: "Done." },
      ])
      .build();

    await parent.run("Delegate a price-lookup task to a sub-agent.");
    await parent.dispose();

    console.log = realLog;
    const all = lines.join("\n");

    const boxCount = (all.match(/Agent Execution Summary/g) ?? []).length;
    expect(boxCount).toBe(1);
    expect(all).toContain("Sub-agent: bitcoin-price-finder");
  }, 30_000);

  it("does not print any dashboard when no sub-agent was dispatched (baseline unaffected)", async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const solo = await ReactiveAgents.create()
      .withName("solo-agent")
      .withProvider("test")
      .withModel("test-model")
      .withObservability({ verbosity: "normal" })
      .withTestScenario([{ text: "Done." }])
      .build();

    await solo.run("Just answer directly, no delegation.");
    await solo.dispose();

    console.log = realLog;
    const all = lines.join("\n");

    const boxCount = (all.match(/Agent Execution Summary/g) ?? []).length;
    expect(boxCount).toBe(1);
    expect(all).not.toContain("Sub-agent:");
  }, 30_000);

  // The trickiest part of this design: a grandchild's dashboard must reach the
  // ROOT's registry, not just its immediate (intermediate) parent's — because
  // `record()` always happens at the SPAWNING agent's own scope, and the
  // intermediate child only sees the root's registry if
  // `sharedChildDashboardRegistry` was correctly threaded into ITS OWN
  // `createLightRuntime` call. If that threading is broken, this either
  // silently drops the grandchild's dashboard (no "Sub-agent: leaf-worker" in
  // the output at all) or the intermediate child crashes trying to resolve a
  // registry that isn't there.
  it("a grandchild's dashboard also rolls up to the root's single print (nested delegation)", async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const filler = "prime the delegation run with a long preamble. ".repeat(6);
    const parentTask = `${filler} NEST_ROOT_TRIGGER: begin the nested delegation.`;

    const agent = await ReactiveAgents.create()
      .withName("nest-rollup-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 3 })
      .withTools()
      .withObservability({ verbosity: "normal" })
      .withTestScenario([
        {
          match: "NEST_ROOT_TRIGGER",
          toolCall: { name: "spawn-agent", args: { task: "LEVELONE do the level-one work", name: "mid-manager" } },
        },
        {
          match: "LEVELONE",
          toolCall: { name: "spawn-agent", args: { task: "LEVELTWO do the leaf work", name: "leaf-worker" } },
        },
        { match: "LEVELTWO", text: "leaf done" },
        { text: "Done." },
      ])
      .build();

    await agent.run(parentTask, { taskId: "nest-rollup-run" });
    await agent.dispose();

    console.log = realLog;
    const all = lines.join("\n");

    const boxCount = (all.match(/Agent Execution Summary/g) ?? []).length;
    expect(boxCount).toBe(1);
    expect(all).toContain("Sub-agent: mid-manager");
    expect(all).toContain("Sub-agent: leaf-worker");
  }, 30_000);
});
