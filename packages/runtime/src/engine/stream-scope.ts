/**
 * Stream scope resolver: the ONE place that decides whether a bus event belongs
 * to the streaming run (root), one of its descendants (sub-agents), or a foreign
 * run on the same shared bus. Backed by core `makeRunTree`.
 *
 * Root events are offered exactly as projected; descendant events go through the
 * SAME projection and are wrapped once as `SubAgentActivity`; foreign events are
 * dropped.
 */
import { Effect } from "effect";
import type { RunNode, RunTree } from "@reactive-agents/core";
import type { AgentStreamEvent, SubAgentRunInfo } from "../stream-types.js";

/** Tree plus whether descendant activity is forwarded (full density only). */
export interface StreamScope {
  readonly tree: RunTree;
  readonly wrapDescendants: boolean;
}

/** A projection result: nothing, one chunk, or several chunks. */
export type Projected = AgentStreamEvent | readonly AgentStreamEvent[] | undefined;

const toRunInfo = (node: RunNode): SubAgentRunInfo => ({
  runId: node.runId,
  ...(node.parentRunId !== undefined ? { parentRunId: node.parentRunId } : {}),
  depth: node.depth,
  name: node.name,
});

/** Wrap a projected chunk as descendant activity. */
export const wrapSubAgent = (node: RunNode, event: AgentStreamEvent): AgentStreamEvent => ({
  _tag: "SubAgentActivity",
  run: toRunInfo(node),
  event,
});

/**
 * Route one bus event by scope. `project` is the existing per-event projection
 * (it never sees foreign events); `offer` enqueues a chunk.
 */
export function routeScoped<E extends { readonly taskId?: unknown }>(
  scope: StreamScope,
  event: E,
  project: (event: E) => Projected,
  offer: (chunk: AgentStreamEvent) => Effect.Effect<void>,
): Effect.Effect<void> {
  const resolved = scope.tree.scopeOf(String(event.taskId ?? ""));
  if (resolved.kind === "foreign") return Effect.void;
  if (resolved.kind === "descendant" && !scope.wrapDescendants) return Effect.void;
  const out = project(event);
  if (out === undefined) return Effect.void;
  const chunks: readonly AgentStreamEvent[] = Array.isArray(out) ? out : [out as AgentStreamEvent];
  const scoped =
    resolved.kind === "root" ? chunks : chunks.map((c) => wrapSubAgent(resolved.node, c));
  return Effect.forEach(scoped, offer, { discard: true });
}

interface LifecycleEvent {
  readonly taskId?: unknown;
  readonly timestamp?: unknown;
  readonly success?: unknown;
  readonly output?: unknown;
  readonly totalTokens?: unknown;
  readonly totalCostUsd?: unknown;
  readonly durationMs?: unknown;
  readonly totalIterations?: unknown;
}

/** A child's `AgentStarted` becomes a `PhaseStarted(sub-agent)`; the root's yields nothing. */
export const projectChildStarted = (e: LifecycleEvent): AgentStreamEvent => ({
  _tag: "PhaseStarted",
  phase: "sub-agent",
  timestamp: typeof e.timestamp === "number" ? e.timestamp : Date.now(),
});

/** A child's `AgentCompleted` becomes a `StreamCompleted` with output, success, tokens, cost. */
export const projectChildCompleted = (e: LifecycleEvent): AgentStreamEvent => ({
  _tag: "StreamCompleted",
  output: typeof e.output === "string" ? e.output : "",
  success: e.success !== false,
  metadata: {
    duration: typeof e.durationMs === "number" ? e.durationMs : 0,
    cost: typeof e.totalCostUsd === "number" ? e.totalCostUsd : 0,
    tokensUsed: typeof e.totalTokens === "number" ? e.totalTokens : 0,
    stepsCount: typeof e.totalIterations === "number" ? e.totalIterations : 0,
  },
});
