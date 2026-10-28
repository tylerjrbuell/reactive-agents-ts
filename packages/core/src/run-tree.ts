/**
 * Delegation-tree resolver: "is this event mine, a descendant's, or foreign?"
 *
 * Pure, synchronous, plain-JSON input (so ui-side ingest records work too).
 *
 * ## Id model (verified against the emission sites)
 *
 * `AgentStarted`/`AgentCompleted` carry `taskId` (the emitting engine's own
 * task id), plus `rootRunId`, `parentRunId` and `depth` lifted from the run's
 * `RunContext`. A `RunContext.runId` is NOT the task id, except at the root:
 * - root: `rootContext(taskId, …)` so `runId === rootRunId === taskId`
 *   (`engine/execute-agent-started.ts`);
 * - child: `childContext` mints `runId = "<parent.runId>.<name>-<8 hex>"`, while
 *   the child's task gets a fresh `generateTaskId()` (`sub-agent-executor.ts`).
 *
 * So `rootRunId`/`parentRunId` are RUN ids and a child's own run id is never on
 * its events. Consequences handled here:
 * - nodes are keyed by `taskId` (what every other bus event carries);
 * - a direct child of the root matches `parentRunId === rootTaskId`;
 * - a deeper node's `parentRunId` is resolved to its parent node by (1) an
 *   explicit `runId` on the event when present, else (2) the minted shape
 *   `<parentRunId>.<displayName>-<8 hex>`. When neither resolves (no display
 *   name, or same-name siblings), the node is still in the tree via
 *   `rootRunId`; only `childrenOf` for that parent is incomplete.
 */

/** One sub-agent run in the delegation tree. */
export interface RunNode {
  /** The emitting engine's task id; the key every bus event carries. */
  readonly taskId: string;
  /** Best-known `RunContext.runId`; falls back to `taskId` while unresolved. */
  readonly runId: string;
  /** The spawner's `RunContext.runId` (equals the root task id for direct children). */
  readonly parentRunId?: string;
  /** Delegation depth: 1 for a direct child of the root. */
  readonly depth: number;
  /** Display name, or the task id when the event carried none. */
  readonly name: string;
  readonly status: "running" | "done" | "failed";
  readonly startedAt: number;
  readonly endedAt?: number;
}

/** Where an event's `taskId` sits relative to the tracked root. */
export type RunScope =
  | { readonly kind: "root" }
  | { readonly kind: "descendant"; readonly node: RunNode }
  | { readonly kind: "foreign" };

/** Incremental resolver over a stream of bus events. */
export interface RunTree {
  /** Fold one event; events outside this root's tree are ignored. */
  observe(event: { readonly _tag: string } & Readonly<Record<string, unknown>>): void;
  /** Classify a `taskId`. */
  scopeOf(taskId: string): RunScope;
  /** All descendants, in start order. The root itself is not a node. */
  nodes(): readonly RunNode[];
  /** Direct children of a run (`runId`, or the root task id), in start order. */
  childrenOf(runId: string): readonly RunNode[];
}

const MINTED_SUFFIX = 8;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

interface Entry {
  node: RunNode;
  /** True once `runId` came from the event or was inferred from a child's `parentRunId`. */
  resolved: boolean;
}

/**
 * Build a resolver for the delegation tree rooted at `rootTaskId` (the root's
 * task id, which is also its `rootRunId`).
 *
 * An `AgentStarted` without `rootRunId` (legacy or hand-rolled) is foreign
 * unless its `parentRunId` is the root or an already-known run.
 */
export function makeRunTree(rootTaskId: string): RunTree {
  const entries = new Map<string, Entry>(); // taskId -> entry, insertion = start order

  const findParent = (parentRunId: string): Entry | undefined => {
    for (const e of entries.values()) if (e.resolved && e.node.runId === parentRunId) return e;
    for (const e of entries.values()) {
      if (e.resolved || e.node.parentRunId === undefined) continue;
      const prefix = `${e.node.parentRunId}.${e.node.name}-`;
      if (parentRunId.startsWith(prefix) && parentRunId.length === prefix.length + MINTED_SUFFIX) {
        e.node = { ...e.node, runId: parentRunId };
        e.resolved = true;
        return e;
      }
    }
    return undefined;
  };

  const onStarted = (event: Readonly<Record<string, unknown>>): void => {
    const taskId = str(event.taskId);
    if (taskId === undefined || taskId === rootTaskId || entries.has(taskId)) return;
    const parentRunId = str(event.parentRunId);
    const root = str(event.rootRunId);
    const parent = parentRunId === undefined || parentRunId === rootTaskId ? undefined : findParent(parentRunId);
    const inTree = root !== undefined ? root === rootTaskId : parentRunId === rootTaskId || parent !== undefined;
    if (!inTree) return;
    const depth = num(event.depth) ?? (parent !== undefined ? parent.node.depth + 1 : 1);
    const runId = str(event.runId);
    entries.set(taskId, {
      resolved: runId !== undefined,
      node: {
        taskId,
        runId: runId ?? taskId,
        ...(parentRunId !== undefined ? { parentRunId } : {}),
        depth,
        name: str(event.agentDisplayName) ?? taskId,
        status: "running",
        startedAt: num(event.timestamp) ?? 0,
      },
    });
  };

  const onCompleted = (event: Readonly<Record<string, unknown>>): void => {
    const taskId = str(event.taskId);
    const entry = taskId === undefined ? undefined : entries.get(taskId);
    if (entry === undefined) return;
    const endedAt = num(event.timestamp);
    entry.node = {
      ...entry.node,
      status: event.success === false ? "failed" : "done",
      ...(endedAt !== undefined ? { endedAt } : {}),
    };
  };

  return {
    observe(event) {
      if (event._tag === "AgentStarted") onStarted(event);
      else if (event._tag === "AgentCompleted") onCompleted(event);
    },
    scopeOf(taskId) {
      if (taskId === rootTaskId) return { kind: "root" };
      const entry = entries.get(taskId);
      return entry === undefined ? { kind: "foreign" } : { kind: "descendant", node: entry.node };
    },
    nodes: () => [...entries.values()].map((e) => e.node),
    childrenOf: (runId) =>
      [...entries.values()].map((e) => e.node).filter((n) => n.parentRunId === runId),
  };
}
