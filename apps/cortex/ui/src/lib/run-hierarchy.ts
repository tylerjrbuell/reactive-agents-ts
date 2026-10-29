/**
 * Beacon delegation hierarchy: which desk run is a child of which.
 *
 * Ingest events are plain JSON, so each root's descendants are fed to core's
 * `makeRunTree` (one hierarchy rule shared with the runtime stream). The tree
 * resolves a child's `parentRunId` (a RunContext run id, which is NOT the
 * store's key) to the parent node; edges here are expressed in store run ids
 * (`AgentNode.runId`, the emitting engine's task id), the key the grid and the
 * canvas use.
 *
 * A node whose parent cannot be resolved is surfaced as its own root; no edge
 * is invented.
 */
import { makeRunTree } from "@reactive-agents/core";
import type { AgentNode } from "./stores/agent-store.js";

/** One desk run placed in the delegation forest. */
export interface HierarchyNode {
  readonly agent: AgentNode;
  /** 0 for a root, else the emitted delegation depth (falls back to tree depth). */
  readonly depth: number;
  readonly children: readonly HierarchyNode[];
}

/** A parent -> child link between two desk runs, by store run id. */
export interface HierarchyEdge {
  readonly parent: string;
  readonly child: string;
}

export interface RunHierarchy {
  /** Delegation forest, roots in input order; children in start order. */
  readonly roots: readonly HierarchyNode[];
  /** Every resolved parent -> child link, parents in pre-order. */
  readonly edges: readonly HierarchyEdge[];
  /** child run id -> parent run id, for resolved links only. */
  readonly parentOf: ReadonlyMap<string, string>;
}

const isRootCandidate = (a: AgentNode): boolean => a.parentRunId === undefined;

/** Fold the desk's runs into a delegation forest. Pure; safe on every store tick. */
export function buildRunHierarchy(agents: readonly AgentNode[]): RunHierarchy {
  const byRun = new Map(agents.map((a) => [a.runId, a]));
  const rootIds = new Set(agents.filter(isRootCandidate).map((a) => a.runId));

  const members = new Map<string, AgentNode[]>();
  for (const a of agents) {
    if (isRootCandidate(a) || a.rootRunId === undefined || !rootIds.has(a.rootRunId)) continue;
    const list = members.get(a.rootRunId) ?? [];
    list.push(a);
    members.set(a.rootRunId, list);
  }

  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const link = (parent: string, child: string): void => {
    parentOf.set(child, parent);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child]);
  };

  for (const rootId of rootIds) {
    const tree = makeRunTree(rootId);
    const ordered = [...(members.get(rootId) ?? [])].sort(
      (x, y) => (x.depth ?? 1) - (y.depth ?? 1) || x.connectedAt - y.connectedAt,
    );
    for (const a of ordered) {
      tree.observe({
        _tag: "AgentStarted",
        taskId: a.runId,
        rootRunId: rootId,
        parentRunId: a.parentRunId,
        ...(a.contextRunId !== undefined ? { runId: a.contextRunId } : {}),
        ...(a.depth !== undefined ? { depth: a.depth } : {}),
        ...(a.displayName !== undefined ? { agentDisplayName: a.displayName } : {}),
        timestamp: a.connectedAt,
      });
      if (a.state === "completed" || a.state === "error") {
        tree.observe({ _tag: "AgentCompleted", taskId: a.runId, success: a.state === "completed", timestamp: a.completedAt });
      }
    }
    const visit = (tid: string, runKey: string): void => {
      for (const child of tree.childrenOf(runKey)) {
        link(tid, child.taskId);
        visit(child.taskId, child.runId);
      }
    };
    visit(rootId, rootId);
  }

  const place = (agent: AgentNode, treeDepth: number): HierarchyNode => ({
    agent,
    depth: agent.depth ?? treeDepth,
    children: (childrenOf.get(agent.runId) ?? []).flatMap((id) => {
      const child = byRun.get(id);
      return child ? [place(child, treeDepth + 1)] : [];
    }),
  });

  const roots = agents
    .filter((a) => !parentOf.has(a.runId))
    .map((a) => place(a, 0))
    .map((n) => ({ ...n, depth: n.agent.parentRunId === undefined ? 0 : n.depth }));

  const edges: HierarchyEdge[] = [];
  const walk = (n: HierarchyNode): void => {
    for (const c of n.children) edges.push({ parent: n.agent.runId, child: c.agent.runId });
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);

  return { roots, edges, parentOf };
}

/** Flatten the forest in display order, skipping descendants of collapsed runs. */
export function flattenVisible(
  roots: readonly HierarchyNode[],
  collapsed: ReadonlySet<string>,
): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  const walk = (n: HierarchyNode): void => {
    out.push(n);
    if (collapsed.has(n.agent.runId)) return;
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}

/** Count of all descendants under a node. */
export function descendantCount(n: HierarchyNode): number {
  return n.children.reduce((s, c) => s + 1 + descendantCount(c), 0);
}
