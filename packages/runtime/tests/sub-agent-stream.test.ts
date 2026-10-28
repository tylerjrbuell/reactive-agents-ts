/**
 * Sub-agent activity on the parent AgentStream (plan 2 Task 2) + the one stream
 * scope resolver (engine/stream-scope.ts).
 *
 * Run: bun test packages/runtime/tests/sub-agent-stream.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { makeRunTree } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import { routeScoped, type StreamScope } from "../src/engine/stream-scope.js";
import { recordRootOnlySequence } from "./_helpers-stream-fixture.js";
import fixture from "./fixtures/root-only-stream.json";

type Activity = Extract<AgentStreamEvent, { _tag: "SubAgentActivity" }>;

async function runParallel(density: "tokens" | "full") {
  const agent = await ReactiveAgents.create()
    .withName("sub-stream")
    .withProvider("test")
    .withTools()
    .withDynamicSubAgents({ maxIterations: 3 })
    .withTestScenario([
      { toolCall: { name: "spawn-agents", args: { tasks: [{ task: "do a", name: "alpha" }, { task: "do b", name: "beta" }] } } },
      { text: "FINAL ANSWER: child done" },
    ])
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .build();
  try {
    const events: AgentStreamEvent[] = [];
    for await (const e of agent.runStream("go", { density })) events.push(e);
    return events;
  } finally {
    await agent.dispose();
  }
}

describe("routeScoped (pure)", () => {
  const started = (taskId: string, parentRunId: string, name: string) =>
    ({ _tag: "AgentStarted", taskId, rootRunId: "root", parentRunId, agentDisplayName: name, timestamp: 1 }) as const;
  const mk = (wrap = true): StreamScope => {
    const tree = makeRunTree("root");
    tree.observe(started("c1", "root", "alpha"));
    return { tree, wrapDescendants: wrap };
  };
  const chunk: AgentStreamEvent = { _tag: "PhaseStarted", phase: "think", timestamp: 1 };
  const collect = (scope: StreamScope, taskId: string) => {
    const out: AgentStreamEvent[] = [];
    Effect.runSync(routeScoped(scope, { taskId }, () => chunk, (c) => Effect.sync(() => void out.push(c))));
    return out;
  };

  test("root passes through unwrapped; descendant wrapped; foreign dropped", () => {
    expect(collect(mk(), "root")).toEqual([chunk]);
    const d = collect(mk(), "c1");
    expect(d).toEqual([{ _tag: "SubAgentActivity", run: { runId: "c1", parentRunId: "root", depth: 1, name: "alpha" }, event: chunk }]);
    expect(collect(mk(), "zzz")).toEqual([]);
  });

  test("wrapDescendants=false drops descendants", () => {
    expect(collect(mk(false), "c1")).toEqual([]);
    expect(collect(mk(false), "root")).toEqual([chunk]);
  });

  test("nested grandchild carries depth 2 and parentRunId of the child", () => {
    const scope = mk();
    scope.tree.observe({ ...started("g1", "root.alpha-deadbeef", "gamma"), depth: 2 });
    scope.tree.observe({ ...started("c1b", "root", "alpha"), taskId: "c1x", runId: "root.alpha-deadbeef" });
    const g = collect(scope, "g1")[0] as Activity;
    expect(g.run.depth).toBe(2);
    expect(g.run.parentRunId).toBe("root.alpha-deadbeef");
  });
});

describe("runStream — sub-agent activity", () => {
  test("parallel children: wrapped start/complete per child, all before root StreamCompleted", async () => {
    const events = await runParallel("full");
    const acts = events.filter((e): e is Activity => e._tag === "SubAgentActivity");
    const names = new Set(acts.map((a) => a.run.name));
    expect(names).toEqual(new Set(["alpha", "beta"]));
    for (const name of names) {
      const mine = acts.filter((a) => a.run.name === name);
      expect(mine.filter((a) => a.event._tag === "PhaseStarted" && (a.event as { phase: string }).phase === "sub-agent")).toHaveLength(1);
      const done = mine.filter((a) => a.event._tag === "StreamCompleted");
      expect(done).toHaveLength(1);
      const c = done[0]!.event as Extract<AgentStreamEvent, { _tag: "StreamCompleted" }>;
      // the shared test scenario may fail a child; the chunk must still report it faithfully
      expect(typeof c.success).toBe("boolean");
      expect(typeof c.output).toBe("string");
      expect(typeof c.metadata.tokensUsed).toBe("number");
      expect(typeof c.metadata.cost).toBe("number");
      expect(done[0]!.run.depth).toBe(1);
    }
    const lastAct = events.map((e) => e._tag).lastIndexOf("SubAgentActivity");
    expect(lastAct).toBeLessThan(events.findIndex((e) => e._tag === "StreamCompleted"));
    // wrapped events never leak unwrapped child phases into the root stream's StreamCompleted count
    expect(events.filter((e) => e._tag === "StreamCompleted")).toHaveLength(1);
  });

  test("nesting (real events): a depth-2 run's parentRunId is the minted run id of a depth-1 run", async () => {
    const agent = await ReactiveAgents.create()
      .withName("sub-stream-nest")
      .withProvider("test")
      .withTools()
      .withDynamicSubAgents({ maxIterations: 4, maxRecursionDepth: 3 })
      .withTestScenario([
        { toolCall: { name: "spawn-agent", args: { task: "level1", name: "child" } } },
        { toolCall: { name: "spawn-agent", args: { task: "level2", name: "grand" } } },
        { text: "FINAL ANSWER: leaf" },
        { text: "FINAL ANSWER: leaf" },
        { text: "FINAL ANSWER: leaf" },
      ])
      .withRequiredTools({ adaptive: false })
      .withMaxIterations(5)
      .build();
    try {
      const acts: Activity[] = [];
      for await (const e of agent.runStream("go", { density: "full" })) {
        if (e._tag === "SubAgentActivity") acts.push(e);
      }
      const depth1RunIds = new Set(acts.filter((a) => a.run.depth === 1).map((a) => a.run.runId));
      const deep = acts.filter((a) => a.run.depth === 2);
      expect(deep.length).toBeGreaterThan(0);
      for (const d of deep) expect(depth1RunIds.has(d.run.parentRunId ?? "")).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 60000);

  test('density "tokens" emits no SubAgentActivity', async () => {
    const events = await runParallel("tokens");
    expect(events.some((e) => e._tag === "SubAgentActivity")).toBe(false);
  });

  test("full-density root-only chunk sequence is byte-identical to the pre-refactor fixture", async () => {
    expect(await recordRootOnlySequence("full")).toEqual(fixture.full);
  });

  test("tokens-density root-only chunk sequence is byte-identical to the pre-refactor fixture", async () => {
    expect(await recordRootOnlySequence("tokens")).toEqual(fixture.tokens);
  });
});
