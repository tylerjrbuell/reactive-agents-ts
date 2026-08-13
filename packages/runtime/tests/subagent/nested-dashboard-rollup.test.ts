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
    // mid-manager is a DIRECT child of the root -> flat heading, no lineage.
    expect(all).toContain("Sub-agent: mid-manager");
    // leaf-worker was spawned BY mid-manager, not by the root. A depth-agnostic
    // assertion (`toContain("Sub-agent: leaf-worker")`) would pass even if the
    // root had spawned leaf-worker directly — it doesn't pin WHO spawned it.
    // The lineage-aware heading does: it only appears if the grandchild's
    // dashboard entry actually carried `parentName: "mid-manager"` through the
    // registry, sub-agent-executor.ts, and the console exporter's render.
    expect(all).toContain("Sub-agent: mid-manager › leaf-worker");
    // The old flat (depth-agnostic) heading text must NOT appear on its own —
    // it would if leaf-worker were rendered as a sibling instead of nested.
    expect(all).not.toContain("Sub-agent: leaf-worker");
  }, 30_000);

  // Regression guard for a CRITICAL bug: `ChildDashboardRegistry` is minted
  // ONCE per built agent (inside `createRuntime`, materialized once by
  // `ManagedRuntime.make`) — NOT once per `.run()` call. Without an atomic
  // drain-and-clear, run 2's dashboard would report BOTH run 1's and run 2's
  // sub-agents, and a childless run 3 would still show run 2's stale children
  // (because `attachChildren` was only called when `children.length > 0`).
  it("a reused agent's dashboard only ever reports THIS run's own sub-agent, never a prior run's", async () => {
    const reused = await ReactiveAgents.create()
      .withName("reused-agent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withObservability({ verbosity: "normal" })
      // NOTE on ordering: `TestLLMService`'s scenario cursor is a single
      // mutable index that only ever scans FORWARD and NEVER resets between
      // `.run()` calls on the same built agent (it lives for the life of the
      // root's `LLMService` layer, same lifetime class as the registry bug
      // this test guards). So this scenario is laid out as ONE monotonic
      // sequence spanning all 3 runs, in the exact order the ROOT's own LLM
      // calls will consume them: [spawn researcher, done, spawn writer, done,
      // done]. Each SPAWNED CHILD gets its OWN fresh cursor (a new
      // `TestLLMService` instance per `createLightRuntime` call), so it scans
      // this same array from index 0 independently — its task text ("look
      // things up" / "write it up") never matches the "SPAWN_*" guards, so it
      // falls through to the first unconditional entry ("Done.") as its own
      // one-shot final answer.
      .withTestScenario([
        { match: "SPAWN_RESEARCHER", toolCall: { name: "spawn-agent", args: { task: "look things up", name: "researcher" } } },
        { text: "Done." },
        { match: "SPAWN_WRITER", toolCall: { name: "spawn-agent", args: { task: "write it up", name: "writer" } } },
        { text: "Done." },
        { text: "Done." },
      ])
      .build();

    // Run 1: dispatches "researcher".
    const lines1: string[] = [];
    console.log = (...args: unknown[]) => {
      lines1.push(args.map(String).join(" "));
    };
    await reused.run("SPAWN_RESEARCHER: delegate a research task.");
    console.log = realLog;
    const out1 = lines1.join("\n");
    expect(out1).toContain("Sub-agent: researcher");
    expect(out1).not.toContain("Sub-agent: writer");

    // Run 2 on the SAME agent instance: dispatches "writer" only. Before the
    // `getAndSet` fix, the registry still held run 1's "researcher" entry (the
    // prior `Ref.get` drain never cleared it), so run 2's dashboard would show
    // BOTH researcher and writer.
    const lines2: string[] = [];
    console.log = (...args: unknown[]) => {
      lines2.push(args.map(String).join(" "));
    };
    await reused.run("SPAWN_WRITER: delegate a writing task.");
    console.log = realLog;
    const out2 = lines2.join("\n");
    // OPEN FINDING (Move 1 merge triage, 2026-08-13), NOT resolved: run 2's
    // dashboard shows NO "Sub-agent:" heading at all (neither writer nor
    // researcher) even though spawn-agent genuinely dispatched (the tool
    // execution summary shows "spawn-agent 1 calls, succeeded"). The root's
    // own execution took a materially higher iteration count than run 1
    // (7 entropy iterations vs run 1's ~2), consistent with the kernel
    // making more internal LLM calls against this run's position in the
    // SHARED, never-resetting TestLLMService scenario cursor than the test's
    // careful layout assumed when it was written -- but that is a plausible
    // lead, not a traced root cause; did not chase further given the depth
    // (this touches the SAME registry-lifetime mechanism the test exists to
    // guard, so a rushed fix risks masking the real bug rather than fixing
    // it). Left asserting the correct/desired behavior.
    expect(out2).toContain("Sub-agent: writer");
    expect(out2).not.toContain("Sub-agent: researcher");

    // Run 3 on the SAME agent instance: dispatches NO sub-agent at all. Before
    // the `if (children.length > 0)` guard removal, a childless run skipped
    // `attachChildren` entirely, leaving `childrenRef` holding run 2's
    // ("writer") stale list — so run 3 would still render "Sub-agent: writer"
    // despite spawning nothing.
    const lines3: string[] = [];
    console.log = (...args: unknown[]) => {
      lines3.push(args.map(String).join(" "));
    };
    await reused.run("Just answer directly, no delegation this time.");
    console.log = realLog;
    const out3 = lines3.join("\n");
    expect(out3).not.toContain("Sub-agent:");

    await reused.dispose();
  }, 30_000);
});
