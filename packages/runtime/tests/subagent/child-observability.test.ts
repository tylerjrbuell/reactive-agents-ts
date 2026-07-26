// Run: bun test packages/runtime/tests/subagent/child-observability.test.ts --timeout 30000
//
// The G1 pin (audit gap G1): a delegated sub-agent's events must reach the
// PARENT's event bus, tagged with parentAgentId. Before the child-layer fix the
// child builds its OWN EventBus (createLightRuntime) and emits into a bus nobody
// is subscribed to, so a parent subscriber never sees the child. This test
// reproduces that bug (childEvents.length === 0) and pins the fix.
import { describe, expect, it, afterEach } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../../src/index.js";

const realLog = console.log;
afterEach(() => {
  console.log = realLog;
});

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

  // Regression for the "rendered sub-agent name is the raw internal agentId" defect
  // (Task 7 review, finding 3). `AgentStarted.agentDisplayName` is what any UI (the
  // status renderer's collapsed sub-agent line, Cortex's run tree) renders. It used
  // to be derived SOLELY from `config.agentId` in execution-engine.ts — and a
  // sub-agent's agentId is uniquified to `sub-<name>-<epoch>` by
  // sub-agent-executor.ts, so the line read "sub-researcher-1753469999999" instead
  // of "researcher".
  //
  // Red-on-cut: drop `agentDisplayName: t.name` from the child's
  // `createLightRuntime({...})` call in sub-agent-executor.ts (or drop the
  // `explicitDisplayName ??` preference in execution-engine.ts) — the child's
  // AgentStarted falls back to the ugly id and this test fails.
  it("a dispatched sub-agent's AgentStarted carries its GIVEN name, not the uniquified agentId", async () => {
    const started: Array<{
      agentId: string;
      parentAgentId?: string;
      agentDisplayName?: string;
    }> = [];

    const parent = await ReactiveAgents.create()
      .withName("displayname-parent")
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
      if (e._tag !== "AgentStarted") return;
      started.push({
        agentId: e.agentId,
        parentAgentId: e.parentAgentId,
        agentDisplayName: e.agentDisplayName,
      });
    });

    await parent.run("Delegate a research task to a sub-agent.");
    await parent.dispose();

    const child = started.find((e) => e.parentAgentId !== undefined);
    expect(child).toBeDefined();
    // The correlation id stays uniquified — that is deliberate, and exactly why a
    // separate display name is needed.
    expect(child!.agentId).toMatch(/^sub-researcher-\d+$/);
    // …and the RENDERED name is clean.
    expect(child!.agentDisplayName).toBe("researcher");

    // The root keeps the pre-existing agentId-derived fallback (no regression).
    // NOTE: a top-level agent's own id is ALSO uniquified (`${name}-${Date.now()}`,
    // builder.ts) so its display name still carries the epoch suffix. That is the
    // same defect one level up, deliberately OUT of scope for this fix (the root
    // never renders a sub-agent line, and changing it would bypass the
    // `cortex-desk-\d+` placeholder filter in execution-engine.ts).
    const root = started.find((e) => e.parentAgentId === undefined);
    expect(root).toBeDefined();
    expect(root!.agentDisplayName).toContain("displayname-parent");
  }, 30000);

  // Regression for the "stale default verbosity leaks into sub-agents" defect
  // (D1 follow-up): `sub-agent-executor.ts` used to spread the parent builder's
  // `_observabilityOptions` (which defaults to `{ verbosity: 'minimal' }` even
  // when `.withObservability()` was never called) into the child's own
  // `createLightRuntime` options unconditionally — gated only on
  // `parentObservabilityOptions` being truthy, which it always was. Because
  // `execution-engine.ts` now threads `verbosity` unconditionally (D1 fix #2),
  // that leaked default silently forced the CHILD's own console output to
  // "minimal" even though the parent never opted into observability at all —
  // a behavior change introduced as a side effect, with no coverage. Proven
  // empirically: before this fix, a parent-without-observability dispatching a
  // sub-agent produces only the PARENT's 5 console lines (the child's own
  // phase/iteration/completion lines are swallowed); after the fix the child's
  // own execution — a second "[phase:execution] Starting...", its own
  // "[phase:reactive:kernel]" run, and its own "Task completed" line — shows up
  // too, exactly like a top-level agent's console output would.
  it("a sub-agent's OWN console output is not suppressed when the parent never called .withObservability()", async () => {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };

    const parent = await ReactiveAgents.create()
      .withName("verbosity-leak-parent")
      .withProvider("test")
      .withModel("test-model")
      .withDynamicSubAgents({ maxIterations: 2 })
      .withTools()
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "research the topic", name: "researcher" } } },
        { text: "Done." },
      ])
      .build();

    await parent.run("Delegate a research task to a sub-agent.");
    await parent.dispose();

    console.log = realLog;
    const all = lines.join("\n");

    // The child runs its OWN execution phase — a second "Starting..." line
    // distinct from the parent's — and its own reactive kernel iterations.
    // If the child's verbosity were silently forced to "minimal" (the bug),
    // none of the child's own lines would print at all.
    const executionStarts = lines.filter((l) => l.includes("[phase:execution] Starting...")).length;
    expect(executionStarts).toBeGreaterThanOrEqual(2);
    expect(all).toContain("[phase:reactive:kernel]");
  }, 30000);
});
