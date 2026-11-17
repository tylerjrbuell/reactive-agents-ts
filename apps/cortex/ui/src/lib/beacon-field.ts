/**
 * Field rules beyond layout and drag: which nodes are hidden inside a
 * collapsed delegation tree, and what a node says about its agent (model,
 * run time, tokens, cost). Pure; `BeaconCanvas` renders it.
 */
import { formatCost, formatTokens, formatTurnDuration, type StatusView } from "@reactive-agents/ui-core";
import type { AgentNode } from "./stores/agent-store.js";
import { AT_REST } from "./beacon-filter.js";

/** Past this many nodes, finished sub-agent trees fold under their parent on their own. */
export const AUTO_COLLAPSE_OVER = 12;

/** Run ids that have at least one sub-agent in `parentOf` (child to parent). */
export function parentsOf(parentOf: ReadonlyMap<string, string>): Set<string> {
  return new Set(parentOf.values());
}

/** Every descendant run id under `runId`. */
export function descendantsOf(runId: string, parentOf: ReadonlyMap<string, string>): Set<string> {
  const kids = new Map<string, string[]>();
  for (const [child, parent] of parentOf) kids.set(parent, [...(kids.get(parent) ?? []), child]);
  const out = new Set<string>();
  const stack = [...(kids.get(runId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/**
 * Parents whose sub-agents are folded away. The viewer's choice (`overrides`,
 * true = collapsed) wins; with no choice, a parent folds on its own once more
 * than {@link AUTO_COLLAPSE_OVER} nodes are shown and every one of its
 * descendants is at rest (finished work does not need a place on the plane).
 */
export function collapsedParents(
  nodes: readonly AgentNode[],
  parentOf: ReadonlyMap<string, string>,
  toneOf: (node: AgentNode) => StatusView["tone"],
  overrides: ReadonlyMap<string, boolean>,
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.runId, n]));
  const auto = nodes.length > AUTO_COLLAPSE_OVER;
  const out = new Set<string>();
  for (const parent of parentsOf(parentOf)) {
    if (!byId.has(parent)) continue;
    const choice = overrides.get(parent);
    if (choice !== undefined) {
      if (choice) out.add(parent);
      continue;
    }
    if (!auto) continue;
    const below = [...descendantsOf(parent, parentOf)].map((id) => byId.get(id)).filter((n): n is AgentNode => n !== undefined);
    if (below.length > 0 && below.every((n) => AT_REST.has(toneOf(n)))) out.add(parent);
  }
  return out;
}

/** The nodes left after folding: a collapsed parent hides all of its descendants. */
export function visibleNodes(
  nodes: readonly AgentNode[],
  parentOf: ReadonlyMap<string, string>,
  collapsed: ReadonlySet<string>,
): { readonly shown: AgentNode[]; readonly hiddenUnder: ReadonlyMap<string, number> } {
  const hidden = new Set<string>();
  const hiddenUnder = new Map<string, number>();
  const present = new Set(nodes.map((n) => n.runId));
  for (const parent of collapsed) {
    const below = [...descendantsOf(parent, parentOf)].filter((id) => present.has(id));
    hiddenUnder.set(parent, below.length);
    for (const id of below) hidden.add(id);
  }
  return { shown: nodes.filter((n) => !hidden.has(n.runId)), hiddenUnder };
}

/** What a Field node says about its agent beyond name and status. */
export interface FieldNodeInfo {
  /** `sub · model` / `model` / `sub-agent` / empty. */
  readonly modelLine: string;
  /** `4m 12s · 2.1k tok · $0.310`; parts with no data are left out. */
  readonly metaLine: string;
}

/** Model and run facts for a node (`now` ms epoch ticks the run time of a live agent). */
export function fieldNodeInfo(node: AgentNode, status: StatusView, now: number): FieldNodeInfo {
  const model = node.model?.trim() ?? "";
  const sub = node.parentRunId !== undefined;
  const modelLine = sub ? (model ? `sub · ${model}` : "sub-agent") : model;
  const parts: string[] = [];
  const start = node.startedAt ?? node.connectedAt;
  if (start > 0) {
    const end = status.tone === "running" ? now : (node.completedAt ?? node.lastEventAt);
    if (end > start) parts.push(formatTurnDuration(end - start));
  }
  if (node.tokensUsed > 0) parts.push(`${formatTokens(node.tokensUsed)} tok`);
  if (node.cost > 0) parts.push(formatCost(node.cost));
  return { modelLine, metaLine: parts.join(" · ") };
}

/** One legend entry: a status and how many agents on the plane have it. */
export interface LegendEntry {
  readonly tone: StatusView["tone"];
  readonly label: string;
  readonly count: number;
}

/** The legend: one entry per status present, in first-seen order (label from the first agent with it). */
export function legendOf(statuses: readonly StatusView[]): LegendEntry[] {
  const out = new Map<StatusView["tone"], LegendEntry>();
  for (const s of statuses) {
    const prev = out.get(s.tone);
    out.set(s.tone, { tone: s.tone, label: prev?.label ?? s.label, count: (prev?.count ?? 0) + 1 });
  }
  return [...out.values()];
}
