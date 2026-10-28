import { describe, expect, test } from "bun:test";
import { makeRunTree } from "../run-tree.js";

// Real shape (verified against execute-agent-started.ts + childContext): the
// event's `taskId` is a fresh per-engine id; `parentRunId` is the SPAWNER'S
// RunContext.runId, which for a child is `<parentRunId>.<name>-<8 hex>` and is
// NOT any taskId. Only the root's runId equals its taskId.
const ROOT = "root-task";
const C1_RUN = `${ROOT}.a-1a2b3c4d`;
const started = (
  taskId: string,
  parentRunId: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  _tag: "AgentStarted",
  taskId,
  rootRunId: ROOT,
  parentRunId,
  agentDisplayName: name,
  timestamp: 1,
  ...extra,
});

describe("makeRunTree", () => {
  test("classifies root, nested descendants, and foreign runs", () => {
    const t = makeRunTree(ROOT);
    t.observe(started("T-c1", ROOT, "a", { depth: 1 }));
    // grandchild's parentRunId is the child's RunContext.runId, not its taskId
    t.observe(started("T-g1", C1_RUN, "b", { depth: 2 }));
    expect(t.scopeOf(ROOT).kind).toBe("root");
    expect(t.scopeOf("T-g1")).toMatchObject({
      kind: "descendant",
      node: { depth: 2, parentRunId: C1_RUN, name: "b" },
    });
    expect(t.childrenOf(C1_RUN).map((n) => n.name)).toEqual(["b"]);
    expect(t.scopeOf("zzz").kind).toBe("foreign");
  });

  test("derives depth when the event omits it, and honours an explicit runId", () => {
    const t = makeRunTree(ROOT);
    t.observe(started("T-c1", ROOT, "a"));
    t.observe(started("T-g1", C1_RUN, "b"));
    expect(t.scopeOf("T-c1")).toMatchObject({ node: { depth: 1 } });
    expect(t.scopeOf("T-g1")).toMatchObject({ node: { depth: 2 } });
    const u = makeRunTree(ROOT);
    u.observe(started("T-c1", ROOT, "a", { runId: "explicit-run" }));
    u.observe(started("T-g1", "explicit-run", "b"));
    expect(u.childrenOf("explicit-run").map((n) => n.taskId)).toEqual(["T-g1"]);
  });

  test("parallel siblings and completion status", () => {
    const t = makeRunTree(ROOT);
    t.observe(started("c1", ROOT, "a"));
    t.observe(started("c2", ROOT, "b"));
    t.observe({ _tag: "AgentCompleted", taskId: "c1", rootRunId: ROOT, success: true });
    t.observe({ _tag: "AgentCompleted", taskId: "c2", rootRunId: ROOT, success: false });
    expect(t.childrenOf(ROOT).map((n) => [n.name, n.status])).toEqual([
      ["a", "done"],
      ["b", "failed"],
    ]);
  });

  test("other trees on a shared bus are ignored", () => {
    const t = makeRunTree(ROOT);
    t.observe({ ...started("x1", "other", "x"), rootRunId: "other" });
    expect(t.nodes()).toHaveLength(0);
    expect(t.scopeOf("x1").kind).toBe("foreign");
  });

  test("legacy event without rootRunId is foreign unless its parent is known", () => {
    const t = makeRunTree(ROOT);
    t.observe({ _tag: "AgentStarted", taskId: "legacy", parentRunId: "nobody", agentDisplayName: "l" });
    expect(t.scopeOf("legacy").kind).toBe("foreign");
    t.observe({ _tag: "AgentStarted", taskId: "kid", parentRunId: ROOT, agentDisplayName: "k" });
    expect(t.scopeOf("kid").kind).toBe("descendant");
  });
});
