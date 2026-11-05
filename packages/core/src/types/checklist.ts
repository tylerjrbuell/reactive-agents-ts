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
  /** `"plan"` = written by the harness from a strategy's plan state, not by a `todo` call. */
  readonly origin?: "plan";
}

/** Any ledger fact the checklist projector consumes. */
export type ChecklistFact = RequirementFact | ChecklistItemFact;

/** Ledger fact: a tool call was issued (structural mirror of the reasoning entry). */
export interface ToolInvocationFact {
  readonly kind: "tool-invocation";
  readonly seq: number;
  readonly iteration: number;
  readonly pass?: string;
  readonly toolName: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly toolCallId?: string;
}

/** Ledger fact: a tool returned (structural mirror of the reasoning entry). */
export interface ToolResultFact {
  readonly kind: "tool-result";
  readonly seq: number;
  readonly iteration: number;
  readonly pass?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly success: boolean;
}

/** Ledger fact: a concrete deliverable was produced (structural mirror). */
export interface ArtifactFact {
  readonly kind: "artifact";
  readonly seq: number;
  readonly iteration: number;
  readonly pass?: string;
  readonly path: string;
  readonly op: string;
  readonly toolCallId?: string;
}

/** Facts that can anchor an inferred checklist completion. Never change gate truth. */
export type ChecklistEvidenceFact = ToolInvocationFact | ToolResultFact | ArtifactFact;

/** Everything the projector and the inference rule read. */
export type ChecklistInputFact = ChecklistFact | ChecklistEvidenceFact;

/** Who set an advisory item's state. Absent on persisted snapshots = `"explicit"`. */
export type ChecklistItemSource = "explicit" | "inferred" | "plan";

/** Pointer at the ledger entry that justified an inferred completion. */
export interface ChecklistEvidenceRef {
  /** Ledger `seq` of the evidence entry (tool-result, artifact or satisfied requirement). */
  readonly seq: number;
  readonly kind: "tool-result" | "artifact" | "requirement";
  /** One-line human summary, e.g. `file-write ./out/report.md`. */
  readonly detail: string;
}

/** An advisory item after folding its facts. */
export interface AdvisoryItem {
  readonly id: string;
  readonly seq: number;
  readonly title: string;
  readonly status: ChecklistItemStatus;
  /** `"plan"` when the item was added from a strategy's plan (harness-driven status). */
  readonly origin?: "plan";
}

/** One rendered checklist row. */
export interface ChecklistRow {
  readonly id: string;
  readonly kind: "requirement" | "advisory";
  readonly title: string;
  readonly status: "pending" | "in_progress" | "done" | "blocked";
  readonly reason?: string;
  /**
   * Advisory rows only. `"inferred"` = done derived from ledger evidence, not marked;
   * `"plan"` = a strategy plan step whose status the harness tracks. Absent = `"explicit"`.
   */
  readonly source?: ChecklistItemSource;
  /** Present iff `source === "inferred"`. */
  readonly evidence?: ChecklistEvidenceRef;
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

const EVIDENCE_KINDS: ReadonlySet<string> = new Set(["tool-invocation", "tool-result", "artifact"]);

/** Structural guard for evidence ledger entries (tool calls/results, artifacts). */
export function isChecklistEvidenceFact(
  entry: Readonly<Record<string, unknown>>,
): entry is Readonly<Record<string, unknown>> & ChecklistEvidenceFact {
  if (typeof entry.seq !== "number" || typeof entry.iteration !== "number") return false;
  if (typeof entry.kind !== "string" || !EVIDENCE_KINDS.has(entry.kind)) return false;
  if (entry.kind === "tool-invocation") return typeof entry.toolName === "string";
  if (entry.kind === "tool-result") return typeof entry.success === "boolean";
  return typeof entry.path === "string";
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
        items.set(added.id, { id: added.id, seq, title: added.title, status: "pending", ...(fact.origin === "plan" ? { origin: "plan" as const } : {}) });
      }
    } else {
      const existing = items.get(change.id);
      if (existing && existing.status !== change.status) items.set(change.id, { ...existing, status: change.status });
    }
  }
  return [...items.values()];
}

// ─── Inferred progress (deterministic, display-side) ────────────────────────

const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[a-z0-9_]/.test(c);

/** `needle` occurs in `text` delimited by non-word characters (no substring-of-word hits). */
function containsToken(text: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return false;
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + needle.length])) return true;
    from = at + 1;
  }
}

const GENERIC_VALUES: ReadonlySet<string> = new Set([
  "true", "false", "null", "utf8", "utf-8", "write", "read", "append", "json", "text", "none", "auto",
]);
const MAX_ARG_VALUE = 240;

/** String arg values distinctive enough to anchor on (path, url, query, id); depth-capped. */
function distinctiveValues(args: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  const out: string[] = [];
  const visit = (v: unknown, depth: number): void => {
    if (typeof v === "string") {
      const t = norm(v);
      if (t.length < 4 || t.length > MAX_ARG_VALUE || GENERIC_VALUES.has(t)) return;
      if (t.length >= 8 || /[./\\:@#_\-\d\s]/.test(t)) out.push(t);
    } else if (depth < 2 && Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
    } else if (depth < 2 && typeof v === "object" && v !== null) {
      for (const x of Object.values(v)) visit(x, depth + 1);
    }
  };
  if (args) for (const v of Object.values(args)) visit(v, 0);
  return out;
}

/** Path anchors: the full path, plus its basename when that carries an extension. */
function pathAnchors(path: string): readonly string[] {
  const full = norm(path);
  const base = full.slice(Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\")) + 1);
  const out = full.length >= 4 ? [full] : [];
  if (base !== full && base.length >= 4 && base.includes(".")) out.push(base);
  return out;
}

const textHasValue = (text: string, value: string): boolean =>
  /\s/.test(value) ? text.includes(value) : containsToken(text, value);

const longestAnchor = (_text: string, found: readonly string[]): number =>
  found.reduce((m, a) => Math.max(m, a.length), 0);

/** Minimum share of a title an anchor must cover to win over sibling items it also matches. */
const MIN_DOMINANT_COVERAGE = 0.6;
/** ...and the winner must cover at least this multiple of the runner-up's share. */
const DOMINANCE_RATIO = 1.5;

/** The `todo` tool writes the list itself; its calls are never evidence of progress. */
const SELF_TOOLS: ReadonlySet<string> = new Set(["todo"]);

interface Candidate {
  readonly seq: number; // ordering seq (when the work was issued)
  readonly evidence: ChecklistEvidenceRef;
  /** Length of the longest anchor found in `text` (0 = no anchor). */
  readonly anchorLength: (text: string) => number;
}

function evidenceCandidates(facts: readonly ChecklistInputFact[]): readonly Candidate[] {
  const results = facts.filter((f): f is ToolResultFact => f.kind === "tool-result");
  const claimed = new Set<number>();
  const resultFor = (inv: ToolInvocationFact): ToolResultFact | undefined => {
    const byId = inv.toolCallId === undefined ? undefined : results.find((r) => r.toolCallId === inv.toolCallId);
    if (byId) return byId;
    const next = results.find(
      (r) => r.seq > inv.seq && !claimed.has(r.seq) && r.toolCallId === undefined && r.toolName === inv.toolName,
    );
    if (next) claimed.add(next.seq);
    return next;
  };
  const out: Candidate[] = [];
  for (const f of facts) {
    if (f.kind === "tool-invocation") {
      if (SELF_TOOLS.has(f.toolName)) continue;
      const res = resultFor(f);
      if (res === undefined || !res.success) continue;
      const nameForms = [norm(f.toolName), norm(f.toolName.replace(/[-_]+/g, " "))];
      const values = distinctiveValues(f.args);
      out.push({
        seq: f.seq,
        evidence: { seq: res.seq, kind: "tool-result", detail: `${f.toolName}${values[0] ? ` ${values[0]}` : ""}` },
        anchorLength: (t) => longestAnchor(t, [...nameForms.filter((n) => containsToken(t, n)), ...values.filter((v) => textHasValue(t, v))]),
      });
    } else if (f.kind === "artifact") {
      const anchors = pathAnchors(f.path);
      out.push({
        seq: f.seq,
        evidence: { seq: f.seq, kind: "artifact", detail: f.path },
        anchorLength: (t) => longestAnchor(t, anchors.filter((a) => textHasValue(t, a))),
      });
    }
  }
  const declared = new Map<string, string>();
  for (const f of facts) {
    if (f.kind !== "requirement") continue;
    if (f.description !== undefined) declared.set(f.requirementId, norm(f.description));
    const desc = declared.get(f.requirementId);
    if (f.status !== "satisfied" || desc === undefined || desc.length < 8) continue;
    out.push({
      seq: f.seq,
      evidence: { seq: f.seq, kind: "requirement", detail: desc },
      anchorLength: (t) => (t.includes(desc) ? desc.length : t.length >= 8 && desc.includes(t) ? t.length : 0),
    });
  }
  return out;
}

/**
 * Infer advisory completions from ledger evidence. Pure and deterministic.
 *
 * An item is inferred done only when ONE evidence fact recorded after the item was
 * added anchors to it and to no other item (or, when restated steps share the anchor,
 * to the one item it covers by >=60% of the title and 1.5x any other): a successful tool call whose name or a
 * distinctive argument value appears in the item title, an artifact path in the title,
 * or a satisfied requirement the title restates. Ambiguous evidence (several items)
 * is dropped. Explicit marks win: an item that is already completed, was set back to
 * `pending`, or has an explicit status change after the evidence is never inferred,
 * so an agent/user mark reverses an inference. Never forces completion without evidence.
 * Advisory only: callers must not count the result toward gate done-ness.
 */
export function inferChecklistProgress(
  items: readonly AdvisoryItem[],
  facts: readonly ChecklistInputFact[],
): ReadonlyMap<string, ChecklistEvidenceRef> {
  const addedSeq = new Map<string, number>();
  const lastExplicit = new Map<string, { seq: number; status: ChecklistItemStatus }>();
  for (const f of facts) {
    if (f.kind !== "checklist-item") continue;
    if (f.change.op === "add") {
      for (const a of f.change.items) if (!addedSeq.has(a.id)) addedSeq.set(a.id, f.seq);
    } else {
      lastExplicit.set(f.change.id, { seq: f.seq, status: f.change.status });
    }
  }
  const texts = new Map(items.map((i) => [i.id, norm(i.title)]));
  const inferred = new Map<string, ChecklistEvidenceRef>();
  const ordered = [...evidenceCandidates(facts)].sort((a, b) => a.seq - b.seq);
  for (const cand of ordered) {
    const hits = items.flatMap((i) => {
      const added = addedSeq.get(i.id);
      if (added === undefined || cand.seq <= added) return [];
      const text = texts.get(i.id) ?? "";
      const len = cand.anchorLength(text);
      return len > 0 ? [{ item: i, coverage: len / Math.max(text.length, 1) }] : [];
    });
    if (hits.length === 0) continue;
    // Several items share the anchor (a re-planned list restates the same step): the
    // evidence belongs to the one it covers most of; a tie or a weak cover stays ambiguous.
    const ranked = [...hits].sort((a, b) => b.coverage - a.coverage);
    if (ranked.length > 1 && (ranked[0]!.coverage < MIN_DOMINANT_COVERAGE || ranked[0]!.coverage < ranked[1]!.coverage * DOMINANCE_RATIO)) continue;
    const item = ranked[0]!.item;
    if (inferred.has(item.id) || item.status === "completed") continue;
    const mark = lastExplicit.get(item.id);
    if (mark !== undefined && (mark.status === "pending" || mark.seq > cand.seq)) continue;
    inferred.set(item.id, cand.evidence);
  }
  return inferred;
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

function buildRows(facts: readonly ChecklistInputFact[]): {
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
  const adv = foldAdvisory(facts.filter((f): f is ChecklistFact => f.kind === "requirement" || f.kind === "checklist-item"));
  const inferred = inferChecklistProgress(adv, facts);
  const advRows: ChecklistRow[] = adv.map((a) => {
    // Plan rows: the harness writes their status from plan state; never inferred.
    if (a.origin === "plan") {
      return { id: a.id, kind: "advisory", title: a.title, status: a.status === "completed" ? "done" : a.status, source: "plan" };
    }
    const evidence = inferred.get(a.id);
    return evidence !== undefined
      ? { id: a.id, kind: "advisory", title: a.title, status: "done", source: "inferred", evidence }
      : { id: a.id, kind: "advisory", title: a.title, status: a.status === "completed" ? "done" : a.status, source: "explicit" };
  });
  return {
    rows: [...reqRows, ...advRows],
    active: advRows.filter((r) => r.status === "in_progress").map((r) => r.id),
    advisory: { done: advRows.filter((r) => r.status === "done").length, total: advRows.length },
    requirements: { done: reqRows.filter((r) => r.status === "done").length, total: reqRows.length },
  };
}

function buildGroup(
  key: string,
  byKey: ReadonlyMap<string, readonly ChecklistInputFact[]>,
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
  facts: readonly ChecklistInputFact[],
  live?: ReadonlyMap<string, readonly ChecklistInputFact[]>,
): ChecklistSnapshot {
  const byKey = new Map<string, ChecklistInputFact[]>([["root", []]]);
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
  let rootFacts: readonly ChecklistInputFact[] = [];
  const childFacts = new Map<string, readonly ChecklistInputFact[]>(); // taskId -> facts
  let last: ChecklistSnapshot | undefined;

  const keyOf = (node: RunNode): string => {
    const own = `${CHILD_PREFIX}${node.name}${TASK_SEP}${node.taskId}`;
    const parent =
      node.parentRunId === undefined ? undefined : tree.nodes().find((n) => n.runId === node.parentRunId);
    return parent === undefined ? own : `${keyOf(parent)}/${own}`;
  };

  const snapshot = (): ChecklistSnapshot | undefined => {
    const live = new Map<string, readonly ChecklistInputFact[]>();
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
        (e): e is Readonly<Record<string, unknown>> & ChecklistInputFact =>
          typeof e === "object" && e !== null &&
          (isChecklistFact(e as Readonly<Record<string, unknown>>) || isChecklistEvidenceFact(e as Readonly<Record<string, unknown>>)),
      );
      const merge = (prev: readonly ChecklistInputFact[]): readonly ChecklistInputFact[] =>
        event.restored === true ? incoming : [...prev, ...incoming];
      if (scope.kind === "root") rootFacts = merge(rootFacts);
      else childFacts.set(taskId, merge(childFacts.get(taskId) ?? []));
      return snapshot();
    },
  };
}
