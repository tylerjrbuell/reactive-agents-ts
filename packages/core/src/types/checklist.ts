import { makeRunTree, type RunNode } from "../run-tree.js";

/**
 * Checklist fact types and the one pure projector.
 *
 * Structural mirrors of reasoning ledger entries (core cannot import reasoning).
 * Requirement rows carry gate truth; advisory (`todo`) items never decide done-ness.
 */

/** Ledger fact: a task requirement declared, satisfied, or blocked. */
export interface RequirementFact {
  readonly kind: "requirement";
  readonly seq: number;
  readonly iteration: number;
  readonly pass?: string;
  readonly requirementId: string;
  readonly status: "declared" | "satisfied" | "blocked";
  readonly description?: string;
  readonly requirementKind?: string;
  readonly reason?: string;
}

/** Status of an advisory checklist item. */
export type ChecklistItemStatus = "pending" | "in_progress" | "completed";

/** A change applied to the advisory checklist. */
export type ChecklistItemOp =
  | { readonly op: "add"; readonly items: readonly { readonly id: string; readonly title: string }[] }
  | { readonly op: "status"; readonly id: string; readonly status: ChecklistItemStatus };

/** Ledger fact: an advisory checklist change. */
export interface ChecklistItemFact {
  readonly kind: "checklist-item";
  readonly seq: number;
  readonly iteration: number;
  readonly pass?: string;
  readonly change: ChecklistItemOp;
  readonly toolCallId?: string;
}

/** Any ledger fact the checklist projector consumes. */
export type ChecklistFact = RequirementFact | ChecklistItemFact;

/** An advisory item after folding its facts. */
export interface AdvisoryItem {
  readonly id: string;
  readonly seq: number;
  readonly title: string;
  readonly status: ChecklistItemStatus;
}

/** One rendered checklist row. */
export interface ChecklistRow {
  readonly id: string;
  readonly kind: "requirement" | "advisory";
  readonly title: string;
  readonly status: "pending" | "in_progress" | "done" | "blocked";
  readonly reason?: string;
}

/** A run's checklist group; children are sub-agent runs. */
export interface ChecklistGroup {
  /** `"root"`, `"sub-agent:<name>"` (merged ledger) or `"sub-agent:<name>#<taskId>"` (live), or nested `/`-joined paths. */
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ChecklistRow[];
  readonly requirements: { readonly done: number; readonly total: number };
  readonly advisory: { readonly done: number; readonly total: number };
  readonly activeAdvisoryIds: readonly string[];
  readonly children: readonly ChecklistGroup[];
  /** True while the group comes from a still-running child's own facts. */
  readonly live?: boolean;
}

/** Projected checklist. Done-ness is `root.requirements` only. */
export interface ChecklistSnapshot {
  readonly root: ChecklistGroup;
  readonly lastSeq: number;
}

const REQUIREMENT_STATUSES: ReadonlySet<string> = new Set(["declared", "satisfied", "blocked"]);

/** Structural guard for bus/stream ledger entries. */
export function isChecklistFact(entry: Readonly<Record<string, unknown>>): entry is Readonly<Record<string, unknown>> & ChecklistFact {
  if (typeof entry.seq !== "number" || typeof entry.iteration !== "number") return false;
  if (entry.kind === "requirement") {
    return typeof entry.requirementId === "string" && typeof entry.status === "string" && REQUIREMENT_STATUSES.has(entry.status);
  }
  if (entry.kind === "checklist-item") {
    const change = entry.change;
    return typeof change === "object" && change !== null && "op" in change;
  }
  return false;
}

/** Fold advisory facts into items. Same-status changes are no-ops; unknown ids ignored. */
export function foldAdvisory(facts: readonly ChecklistFact[]): readonly AdvisoryItem[] {
  const items = new Map<string, AdvisoryItem>();
  let maxSeq = 0;
  for (const fact of facts) {
    if (fact.kind !== "checklist-item") continue;
    const { change } = fact;
    if (change.op === "add") {
      for (const added of change.items) {
        if (items.has(added.id)) continue;
        const parsed = Number(added.id);
        const seq = Number.isInteger(parsed) && parsed > 0 ? parsed : maxSeq + 1;
        maxSeq = Math.max(maxSeq, seq);
        items.set(added.id, { id: added.id, seq, title: added.title, status: "pending" });
      }
    } else {
      const existing = items.get(change.id);
      if (existing && existing.status !== change.status) items.set(change.id, { ...existing, status: change.status });
    }
  }
  return [...items.values()];
}

/** The next `count` advisory ids after the highest existing seq. */
export function nextAdvisoryIds(items: readonly AdvisoryItem[], count: number): readonly string[] {
  const base = items.reduce((m, i) => Math.max(m, i.seq), 0);
  return Array.from({ length: count }, (_, i) => String(base + i + 1));
}

const CHILD_PREFIX = "sub-agent:";
/** Live group keys are `sub-agent:<name>#<taskId>` so same-name siblings stay distinct. */
const TASK_SEP = "#";

/** Strip the live `#<taskId>` suffix from every path segment (merged ledger keys are name-only). */
const nameKeyOf = (key: string): string =>
  key.split("/").map((seg) => (seg.includes(TASK_SEP) ? seg.slice(0, seg.indexOf(TASK_SEP)) : seg)).join("/");

/** Group key from pass provenance; retry/continuation passes belong to the owner (root). */
function groupKeyOf(pass: string | undefined): string {
  return pass !== undefined && pass.startsWith(CHILD_PREFIX) ? pass : "root";
}

function labelOf(key: string): string {
  if (key === "root") return "root";
  const last = key.split("/").pop() ?? key;
  const bare = last.startsWith(CHILD_PREFIX) ? last.slice(CHILD_PREFIX.length) : last;
  const hash = bare.indexOf(TASK_SEP);
  return hash === -1 ? bare : bare.slice(0, hash);
}

function buildRows(facts: readonly ChecklistFact[]): {
  rows: ChecklistRow[];
  active: string[];
  advisory: { done: number; total: number };
  requirements: { done: number; total: number };
} {
  const reqs = new Map<string, { title?: string; kind?: string; status: RequirementFact["status"]; reason?: string }>();
  for (const f of facts) {
    if (f.kind !== "requirement") continue;
    const prev = reqs.get(f.requirementId);
    reqs.set(f.requirementId, {
      title: f.description ?? prev?.title,
      kind: f.requirementKind ?? prev?.kind,
      status: f.status,
      ...(f.status === "blocked" && f.reason !== undefined ? { reason: f.reason } : {}),
    });
  }
  const reqRows: ChecklistRow[] = [...reqs.entries()].map(([id, r]) => ({
    id,
    kind: "requirement",
    title: r.title ?? r.kind ?? id,
    status: r.status === "satisfied" ? "done" : r.status === "blocked" ? "blocked" : "pending",
    ...(r.reason !== undefined ? { reason: r.reason } : {}),
  }));
  const adv = foldAdvisory(facts);
  const advRows: ChecklistRow[] = adv.map((a) => ({
    id: a.id,
    kind: "advisory",
    title: a.title,
    status: a.status === "completed" ? "done" : a.status,
  }));
  return {
    rows: [...reqRows, ...advRows],
    active: adv.filter((a) => a.status === "in_progress").map((a) => a.id),
    advisory: { done: advRows.filter((r) => r.status === "done").length, total: advRows.length },
    requirements: { done: reqRows.filter((r) => r.status === "done").length, total: reqRows.length },
  };
}

function buildGroup(
  key: string,
  byKey: ReadonlyMap<string, readonly ChecklistFact[]>,
  liveKeys: ReadonlySet<string>,
  allKeys: readonly string[],
): ChecklistGroup {
  const built = buildRows(byKey.get(key) ?? []);
  const childKeys = allKeys.filter((k) => {
    if (k === key || k === "root") return false;
    const parent = k.includes("/") ? k.slice(0, k.lastIndexOf("/")) : "root";
    return parent === key;
  });
  return {
    key,
    label: labelOf(key),
    rows: built.rows,
    requirements: built.requirements,
    advisory: built.advisory,
    activeAdvisoryIds: built.active,
    children: childKeys.map((k) => buildGroup(k, byKey, liveKeys, allKeys)),
    ...(liveKeys.has(key) ? { live: true as const } : {}),
  };
}

/**
 * Project ledger facts into a checklist tree. `live` holds running children's own
 * facts by group key; merged facts for the same key replace the live entry.
 */
export function projectChecklist(
  facts: readonly ChecklistFact[],
  live?: ReadonlyMap<string, readonly ChecklistFact[]>,
): ChecklistSnapshot {
  const byKey = new Map<string, ChecklistFact[]>([["root", []]]);
  for (const f of facts) {
    const key = groupKeyOf(f.pass);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(f);
    else byKey.set(key, [f]);
  }
  const liveKeys = new Set<string>();
  if (live) {
    for (const [key, liveFacts] of live) {
      if (key === "root") continue;
      // Merged ledger facts (name-keyed provenance) replace the live entry.
      if (byKey.has(key) || byKey.has(nameKeyOf(key))) continue;
      byKey.set(key, [...liveFacts]);
      liveKeys.add(key);
    }
  }
  // Materialise missing ancestors so nested paths always hang off a parent.
  for (const key of [...byKey.keys()]) {
    let cur = key;
    while (cur.includes("/")) {
      cur = cur.slice(0, cur.lastIndexOf("/"));
      if (!byKey.has(cur)) byKey.set(cur, []);
    }
  }
  const allKeys = [...byKey.keys()];
  const lastSeq = facts.reduce((m, f) => Math.max(m, f.seq), 0);
  return { root: buildGroup("root", byKey, liveKeys, allKeys), lastSeq };
}

/** True when any row or status differs; a `lastSeq`-only change does not count. */
export function checklistChanged(prev: ChecklistSnapshot | undefined, next: ChecklistSnapshot): boolean {
  if (prev === undefined) return true;
  return JSON.stringify(prev.root) !== JSON.stringify(next.root);
}

/** Bus event shape the tracker folds; plain JSON so ui-side records work. */
type TrackedEvent = { readonly _tag: string } & Readonly<Record<string, unknown>>;

/** Live accumulator over bus events; see {@link makeChecklistTracker}. */
export interface ChecklistTracker {
  /** Fold one event. Returns a snapshot only when the checklist visibly changed. */
  track(event: TrackedEvent): ChecklistSnapshot | undefined;
}

/**
 * The one live-tree rule for the checklist: folds `LedgerEntryAppended`
 * (including `restored` seeds), `AgentStarted` and `AgentCompleted` into
 * {@link projectChecklist}. Delegation membership comes from `makeRunTree`;
 * nothing here re-implements tree logic. Events outside the root's tree are
 * ignored. A `restored` batch replaces that run's prior facts (it is the
 * seed, not an increment).
 */
export function makeChecklistTracker(rootTaskId: string): ChecklistTracker {
  const tree = makeRunTree(rootTaskId);
  let rootFacts: readonly ChecklistFact[] = [];
  const childFacts = new Map<string, readonly ChecklistFact[]>(); // taskId -> facts
  let last: ChecklistSnapshot | undefined;

  const keyOf = (node: RunNode): string => {
    const own = `${CHILD_PREFIX}${node.name}${TASK_SEP}${node.taskId}`;
    const parent =
      node.parentRunId === undefined ? undefined : tree.nodes().find((n) => n.runId === node.parentRunId);
    return parent === undefined ? own : `${keyOf(parent)}/${own}`;
  };

  const snapshot = (): ChecklistSnapshot | undefined => {
    const live = new Map<string, readonly ChecklistFact[]>();
    for (const node of tree.nodes()) live.set(keyOf(node), childFacts.get(node.taskId) ?? []);
    const next = projectChecklist(rootFacts, live);
    // An empty first snapshot (run started, nothing declared yet) is not news.
    if (last === undefined && next.root.rows.length === 0 && next.root.children.length === 0) return undefined;
    if (!checklistChanged(last, next)) return undefined;
    last = next;
    return next;
  };

  return {
    track(event) {
      if (event._tag === "AgentStarted" || event._tag === "AgentCompleted") {
        tree.observe(event);
        return snapshot();
      }
      if (event._tag !== "LedgerEntryAppended") return undefined;
      const taskId = typeof event.taskId === "string" ? event.taskId : undefined;
      if (taskId === undefined || !Array.isArray(event.entries)) return undefined;
      const scope = tree.scopeOf(taskId);
      if (scope.kind === "foreign") return undefined;
      const incoming = event.entries.filter(
        (e): e is Readonly<Record<string, unknown>> & ChecklistFact =>
          typeof e === "object" && e !== null && isChecklistFact(e as Readonly<Record<string, unknown>>),
      );
      const merge = (prev: readonly ChecklistFact[]): readonly ChecklistFact[] =>
        event.restored === true ? incoming : [...prev, ...incoming];
      if (scope.kind === "root") rootFacts = merge(rootFacts);
      else childFacts.set(taskId, merge(childFacts.get(taskId) ?? []));
      return snapshot();
    },
  };
}
