import { describe, it, expect } from "bun:test";
import { get } from "svelte/store";
import { createAgentStore } from "./agent-store.js";
import { buildRunHierarchy } from "../run-hierarchy.js";

const ROOT = "task-root";
const C1_RUN = `${ROOT}.alpha-0a1b2c3d`;

function started(
  store: ReturnType<typeof createAgentStore>,
  taskId: string,
  extra: Record<string, unknown>,
) {
  store.handleLiveMessage({
    agentId: `agent-${taskId}`,
    runId: taskId,
    type: "AgentStarted",
    payload: { taskId, ...extra },
  });
}

function seed() {
  const store = createAgentStore({ loadOnInit: false, now: () => 1_700_000_000_000 });
  started(store, ROOT, { rootRunId: ROOT, depth: 0, agentDisplayName: "lead" });
  // parentAgentId is an AGENT id; it must never be mistaken for a run id.
  started(store, "task-c1", { rootRunId: ROOT, parentRunId: ROOT, parentAgentId: "agent-task-root", depth: 1, agentDisplayName: "alpha" });
  started(store, "task-c2", { rootRunId: ROOT, parentRunId: ROOT, parentAgentId: "agent-task-root", depth: 1, agentDisplayName: "beta" });
  started(store, "task-g1", { rootRunId: ROOT, parentRunId: C1_RUN, depth: 2, agentDisplayName: "gamma" });
  return store;
}

describe("agent-store sub-agent hierarchy", () => {
  it("captures parentRunId / rootRunId / depth from AgentStarted, never from parentAgentId", () => {
    const store = seed();
    const byRun = new Map(get({ subscribe: store.subscribe }).map((a) => [a.runId, a]));
    expect(byRun.get("task-c1")).toMatchObject({ parentRunId: ROOT, rootRunId: ROOT, depth: 1 });
    expect(byRun.get("task-g1")).toMatchObject({ parentRunId: C1_RUN, rootRunId: ROOT, depth: 2 });
    expect(byRun.get(ROOT)?.parentRunId).toBeUndefined();

    const legacy = createAgentStore({ loadOnInit: false });
    started(legacy, "orphan", { parentAgentId: "agent-x" });
    expect(get({ subscribe: legacy.subscribe })[0]?.parentRunId).toBeUndefined();
  });

  it("yields edges root->c1, root->c2, c1->g1 keyed by the store's run ids", () => {
    const store = seed();
    const h = buildRunHierarchy(get({ subscribe: store.subscribe }));
    expect(h.edges).toEqual([
      { parent: ROOT, child: "task-c1" },
      { parent: ROOT, child: "task-c2" },
      { parent: "task-c1", child: "task-g1" },
    ]);
    expect(h.roots.map((r) => r.agent.runId)).toEqual([ROOT]);
    const root = h.roots[0]!;
    expect(root.children.map((c) => c.agent.runId)).toEqual(["task-c1", "task-c2"]);
    expect(root.children[0]!.children.map((c) => c.agent.runId)).toEqual(["task-g1"]);
    expect(root.children[0]!.children[0]!.depth).toBe(2);
  });

  it("a node whose parent is not resolvable stays under its root without a false edge", () => {
    const store = createAgentStore({ loadOnInit: false });
    started(store, ROOT, { rootRunId: ROOT, depth: 0 });
    started(store, "lost", { rootRunId: ROOT, parentRunId: "task-root.unknown-ffffffff", depth: 2 });
    const h = buildRunHierarchy(get({ subscribe: store.subscribe }));
    expect(h.edges).toEqual([]);
    expect(h.roots.map((r) => r.agent.runId).sort()).toEqual(["lost", ROOT].sort());
  });

  it("keeps hierarchy fields across a REST refresh and carries the chat session tag", async () => {
    const rows = [{ runId: "task-c1", agentId: "agent-task-c1", status: "live", iterationCount: 0, tokensUsed: 0, cost: 0 }];
    const store = createAgentStore({
      loadOnInit: false,
      fetchImpl: async () => new Response(JSON.stringify(rows), { status: 200 }),
    });
    started(store, "task-c1", { rootRunId: ROOT, parentRunId: ROOT, depth: 1 });
    store.handleLiveMessage({ agentId: "a", runId: ROOT, type: "AgentStarted", sessionId: "sess-1", payload: { taskId: ROOT, rootRunId: ROOT, depth: 0 } });
    expect(get({ subscribe: store.subscribe }).find((a) => a.runId === ROOT)?.chatSessionId).toBe("sess-1");
    await store.refresh();
    expect(get({ subscribe: store.subscribe })[0]).toMatchObject({ parentRunId: ROOT, rootRunId: ROOT, depth: 1 });
  });
});
