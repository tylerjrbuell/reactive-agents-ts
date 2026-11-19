// File: src/strategies/structured-steps.ts
//
// Builders for the `structured` payload on `ReasoningStepCompleted` bus events
// (`ReasoningStepData` from @reactive-agents/core). Kept out of the strategy
// files (ceiling-pinned) so live UIs get real tree / code / critique data
// without parsing step text. Pure data + one publishing helper; the text
// fields of every event stay exactly as before.
import { Effect } from "effect";
import type { ReasoningStepData } from "@reactive-agents/core";
import { publishReasoningStep } from "../kernel/utils/service-utils.js";

/** The slice of a tree-of-thought node the payload needs. */
export interface TotNodeLike {
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly score: number;
  readonly content: string;
}

/** `tot-node` payload for one explored node. `pruned` = below the pruning threshold at expansion. */
export const totNodeData = (
  node: TotNodeLike,
  flags: { readonly pruned: boolean; readonly selected: boolean },
): ReasoningStepData => ({
  kind: "tot-node",
  nodeId: node.id,
  parentId: node.parentId,
  depth: node.depth,
  score: node.score,
  pruned: flags.pruned,
  selected: flags.selected,
  content: node.content,
});

/** Node ids from the root to `leaf`, in order (walks `parentId` through `allNodes`). */
export const ancestorIds = (allNodes: readonly TotNodeLike[], leaf: TotNodeLike): string[] => {
  const ids: string[] = [leaf.id];
  let current: TotNodeLike | undefined = leaf;
  while (current?.parentId) {
    current = allNodes.find((n) => n.id === current!.parentId);
    if (current) ids.unshift(current.id);
  }
  return ids;
};

type Bus = Parameters<typeof publishReasoningStep>[0];

/**
 * After the best path is chosen: re-emit each explored node on that path with
 * `selected: true` (a later `tot-node` for the same `nodeId` supersedes the
 * earlier one), then one `tot-path` event with the chosen ids root to leaf.
 * `prunedBelow` is the expansion pruning threshold, so `pruned` stays truthful.
 */
export const publishTotSelection = (
  eventBus: Bus,
  ctx: { readonly taskId: string; readonly step: number; readonly totalSteps: number; readonly prunedBelow: number; readonly rootContent: string },
  allNodes: readonly TotNodeLike[],
  bestLeaf: TotNodeLike,
): Effect.Effect<void, never> => {
  const explored = ancestorIds(allNodes, bestLeaf);
  // The root is never in `allNodes`; it is the parent of the path's first node.
  const rootId = allNodes.find((n) => n.id === explored[0])?.parentId ?? null;
  const root: TotNodeLike[] = rootId === null ? [] : [{ id: rootId, parentId: null, depth: 0, score: 1, content: ctx.rootContent }];
  const ids = rootId === null ? explored : [rootId, ...explored];
  const emit = (structured: ReasoningStepData, thought: string) =>
    publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId: ctx.taskId,
      strategy: "tree-of-thought",
      step: ctx.step,
      totalSteps: ctx.totalSteps,
      thought,
      kernelPass: "tree-of-thought:select",
      structured,
    });
  const selectedNodes = [
    ...root,
    ...explored.map((id) => allNodes.find((n) => n.id === id)).filter((n): n is TotNodeLike => n !== undefined),
  ];
  return Effect.forEach(
    selectedNodes,
    (n) => emit(totNodeData(n, { pruned: n.score < ctx.prunedBelow, selected: true }), `[TOT] selected d=${n.depth}`),
    { discard: true },
  ).pipe(Effect.zipRight(emit({ kind: "tot-path", nodeIds: ids }, `[TOT] best path (${ids.length} nodes)`)));
};

/** `reflexion` payload: the full critique and whether it accepted the attempt. */
export const reflexionData = (critique: string, accepted: boolean): ReasoningStepData => ({
  kind: "reflexion",
  critique,
  accepted,
});

/**
 * `code-action` payload for one iteration. `stdout` is the observation text the
 * verifier and model see (tool calls + final result; the Worker sandbox has no
 * separate stdout stream), `stderr` the sandbox failure message. Absent fields
 * are omitted, not empty.
 */
export const codeActionData = (p: {
  readonly code: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly verify?: { readonly verdict: string; readonly summary: string };
}): ReasoningStepData => ({
  kind: "code-action",
  code: p.code,
  ...(p.stdout !== undefined ? { stdout: p.stdout } : {}),
  ...(p.stderr !== undefined ? { stderr: p.stderr } : {}),
  ...(p.verify !== undefined ? { verify: p.verify } : {}),
});
