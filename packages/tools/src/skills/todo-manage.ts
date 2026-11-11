/**
 * skills/todo-manage.ts — list management for the todo tool: `edit`, `remove`,
 * `clear` and `patch`, the local fold of checklist ops, and id issue.
 *
 * Each action returns a lead line plus the ledger `changes`; skills/todo.ts
 * renders the list after the changes and the closing line. Pure; never throws.
 */
import type { AdvisoryItem, ChecklistItemOp, ChecklistItemStatus } from "@reactive-agents/core";
import { resolveTodoTargets, resolveTodoTargetsAllowMissing } from "./todo-targets.js";

/** What one list-management action did: a lead line (may be empty) and the ops to commit. */
export interface TodoManageOutcome {
  readonly ok: boolean;
  /** Text shown above the rendered list; empty or ends with a newline. */
  readonly lead: string;
  readonly changes: readonly ChecklistItemOp[];
}

/** Closed table: observed status words -> ledger status. */
const TODO_STATUS_ALIASES: Readonly<Record<string, ChecklistItemStatus>> = {
  pending: "pending",
  todo: "pending",
  open: "pending",
  reopen: "pending",
  not_started: "pending",
  in_progress: "in_progress",
  "in-progress": "in_progress",
  started: "in_progress",
  start: "in_progress",
  doing: "in_progress",
  working: "in_progress",
  completed: "completed",
  complete: "completed",
  done: "completed",
  finished: "completed",
  finish: "completed",
  closed: "completed",
};

/** Map a status word (case/whitespace tolerant) to a ledger status; `undefined` when unknown. */
export function todoStatusOf(word: unknown): ChecklistItemStatus | undefined {
  if (typeof word !== "string") return undefined;
  const key = word.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TODO_STATUS_ALIASES, key) ? TODO_STATUS_ALIASES[key] : undefined;
}

/** Compile-time exhaustiveness check for `ChecklistItemOp` switches. */
const unhandledOp = (op: never): never => op;

/**
 * Apply ops to folded items, matching core `foldAdvisory`: a present id is
 * not added twice, and ops naming an unknown id do nothing.
 */
export function applyTodoOps(items: readonly AdvisoryItem[], changes: readonly ChecklistItemOp[]): readonly AdvisoryItem[] {
  let next = items;
  for (const c of changes) {
    switch (c.op) {
      case "add":
        for (const a of c.items) {
          if (next.some((t) => t.id === a.id)) continue;
          const parsed = Number(a.id);
          const max = next.reduce((m, t) => Math.max(m, t.seq), 0);
          const seq = Number.isInteger(parsed) && parsed > 0 ? parsed : max + 1;
          next = [...next, { id: a.id, seq, title: a.title, status: "pending" }];
        }
        break;
      case "status":
        next = next.map((t) => (t.id === c.id ? { ...t, status: c.status } : t));
        break;
      case "edit":
        next = next.map((t) => (t.id === c.id ? { ...t, title: c.title } : t));
        break;
      case "remove":
        next = next.filter((t) => !c.ids.includes(t.id));
        break;
      default:
        unhandledOp(c);
    }
  }
  return next;
}

/**
 * The next `count` ids, after the highest id ever issued: the current items
 * and every `add` in `history` (the ops the list was folded from). A removed
 * item's id is never issued again. Without history this equals core
 * `nextAdvisoryIds`.
 */
export function nextTodoIds(
  items: readonly AdvisoryItem[],
  history: readonly ChecklistItemOp[],
  count: number,
): readonly string[] {
  let base = items.reduce((m, i) => Math.max(m, i.seq), 0);
  for (const c of history) {
    if (c.op !== "add") continue;
    for (const a of c.items) {
      const n = Number(a.id);
      if (Number.isInteger(n) && n > base) base = n;
    }
  }
  return Array.from({ length: count }, (_, i) => String(base + i + 1));
}

const fail = (lead: string): TodoManageOutcome => ({ ok: false, lead: `${lead}\n`, changes: [] });
const noChange = (line: string): TodoManageOutcome => ({ ok: true, lead: `No change: ${line}\n`, changes: [] });

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const itemList = (ids: readonly string[]): string => `${ids.length === 1 ? "item" : "items"} ${ids.join(", ")}`;
const missingNote = (ids: readonly string[]): string => `No ${itemList(ids)} (already removed or never added).`;
const validIds = (items: readonly AdvisoryItem[]): string => items.map((t) => t.id).join(", ") || "none";

const EDIT_USAGE = `Usage: todo({action:"edit", id:N, text:"new title"})`;
const REMOVE_USAGE =
  `Usage: todo({action:"remove", id:N}) or todo({action:"remove", ids:[N,M]}). To empty the list use todo({action:"clear"}).`;
const PATCH_USAGE =
  `Usage: todo({action:"patch", ops:[{id:N, text:"new title"}, {id:N, status:"done"}, {remove:N}]})`;

/** The new title of an edit: `text`, `title`, or a single item string. */
function editTitle(args: Readonly<Record<string, unknown>>): string {
  const raw = args.text ?? args.title ?? args.items;
  const one = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  return typeof one === "string" ? one.trim() : "";
}

/** Only id-bearing keys: for `edit`, `items`/`text` carry the new title, not the target. */
const idTargets = (args: Readonly<Record<string, unknown>>): Record<string, unknown> => ({ id: args.id, ids: args.ids });

/** `edit`: replace one item's title; status is kept. */
export function editTodoItem(items: readonly AdvisoryItem[], args: Readonly<Record<string, unknown>>): TodoManageOutcome {
  const title = editTitle(args);
  if (title === "") return fail(`edit needs a non-empty text for the new title. ${EDIT_USAGE}`);
  const r = resolveTodoTargets(items, idTargets(args));
  if (!r.ok) return fail(`${r.error}\n${EDIT_USAGE}`);
  const [id, ...more] = r.ids;
  if (id === undefined) return fail(EDIT_USAGE);
  if (more.length > 0) return fail(`edit changes one item at a time; got ids ${r.ids.join(", ")}. ${EDIT_USAGE}`);
  if (items.find((t) => t.id === id)?.title === title) return noChange(`item ${id} already has that title.`);
  return { ok: true, lead: `Edited item ${id}.\n`, changes: [{ op: "edit", id, title }] };
}

/** `remove`: delete items by id or title. Unknown numeric ids are a noted no-op. */
export function removeTodoItems(items: readonly AdvisoryItem[], args: Readonly<Record<string, unknown>>): TodoManageOutcome {
  const r = resolveTodoTargetsAllowMissing(items, args);
  if (!r.ok) return fail(`${r.error}\n${REMOVE_USAGE}`);
  if (r.ids.length === 0) {
    return noChange(
      `no ${itemList(r.missing)} to remove (already removed or never added). Valid ids: ${validIds(items)}.`,
    );
  }
  const note = r.missing.length > 0 ? ` ${missingNote(r.missing)}` : "";
  return { ok: true, lead: `Removed ${itemList(r.ids)}.${note}\n`, changes: [{ op: "remove", ids: r.ids }] };
}

/**
 * `clear`: remove every item, or only those in `status` (e.g. `"completed"`).
 * `status` is a raw status word; an unknown word is refused.
 */
export function clearTodoItems(items: readonly AdvisoryItem[], status: unknown): TodoManageOutcome {
  const filter = status == null || status === "" ? undefined : todoStatusOf(status);
  if (status != null && status !== "" && filter === undefined) {
    return fail(`Unknown status "${String(status)}" for clear. Use todo({action:"clear"}) or todo({action:"clear", status:"completed"}).`);
  }
  const ids = items.filter((t) => filter === undefined || t.status === filter).map((t) => t.id);
  const label = filter === undefined ? "" : `${filter === "in_progress" ? "in-progress" : filter} `;
  if (ids.length === 0) {
    return noChange(filter === undefined ? "the list is already empty." : `no ${label}items to clear.`);
  }
  return { ok: true, lead: `Cleared ${plural(ids.length, `${label}item`)}.\n`, changes: [{ op: "remove", ids }] };
}

/** Parse `ops` (array or JSON string of one) into objects; `undefined` when unusable. */
function parseOps(raw: unknown): readonly unknown[] | undefined {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

const REMOVE_WORDS: ReadonlySet<string> = new Set(["remove", "delete", "rm", "del"]);

/** One patch op as changes over `cur`, or the reason it is invalid. */
function patchOp(
  cur: readonly AdvisoryItem[],
  raw: unknown,
): { readonly changes: readonly ChecklistItemOp[]; readonly missing: readonly string[] } | { readonly error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "each op must be an object like {id:N, text:\"...\"}, {id:N, status:\"done\"} or {remove:N}." };
  }
  const o = raw as Readonly<Record<string, unknown>>;
  const verb = typeof (o.op ?? o.action) === "string" ? String(o.op ?? o.action).trim().toLowerCase() : "";
  if (o.remove != null || REMOVE_WORDS.has(verb)) {
    const targets = typeof o.remove === "boolean" || o.remove == null ? { id: o.id, ids: o.ids } : { ids: o.remove };
    const r = resolveTodoTargetsAllowMissing(cur, targets);
    if (!r.ok) return { error: r.error.replace("\n", " ") };
    return { changes: r.ids.length > 0 ? [{ op: "remove", ids: r.ids }] : [], missing: r.missing };
  }
  const hasTitle = o.text != null || o.title != null;
  if (o.id == null || (!hasTitle && o.status == null)) {
    return { error: "each op needs an id with text or status, or remove." };
  }
  const r = resolveTodoTargets(cur, { id: o.id });
  if (!r.ok) return { error: r.error.replace("\n", " ") };
  const id = r.ids[0] as string;
  const changes: ChecklistItemOp[] = [];
  const item = cur.find((t) => t.id === id);
  if (hasTitle) {
    const title = editTitle({ text: o.text, title: o.title });
    if (title === "") return { error: `the new title of item ${id} is empty.` };
    if (item?.title !== title) changes.push({ op: "edit", id, title });
  }
  if (o.status != null) {
    const status = todoStatusOf(o.status);
    if (status === undefined) return { error: `unknown status "${String(o.status)}"; use pending, in_progress or done.` };
    if (item?.status !== status) changes.push({ op: "status", id, status });
  }
  return { changes, missing: [] };
}

/**
 * `patch`: several ops in order as one result. Each op sees the list after
 * the ops before it. An invalid op fails the whole patch with nothing changed;
 * removing an unknown id is a noted no-op. One item is started at a time.
 */
export function patchTodoItems(items: readonly AdvisoryItem[], rawOps: unknown): TodoManageOutcome {
  const ops = parseOps(rawOps);
  if (ops === undefined) return fail(`patch needs a non-empty ops list. ${PATCH_USAGE}`);
  let cur = items;
  const changes: ChecklistItemOp[] = [];
  const missing: string[] = [];
  let started: string | undefined;
  let skippedStart = false;
  for (const [i, raw] of ops.entries()) {
    const r = patchOp(cur, raw);
    if ("error" in r) return fail(`patch op ${i + 1}: ${r.error} Nothing was changed. ${PATCH_USAGE}`);
    for (const c of r.changes) {
      if (c.op === "status" && c.status === "in_progress") {
        if (started !== undefined) {
          skippedStart = true;
          continue;
        }
        started = c.id;
      }
      changes.push(c);
      cur = applyTodoOps(cur, [c]);
    }
    missing.push(...r.missing.filter((id) => !missing.includes(id)));
  }
  const notes = [
    ...(missing.length > 0 ? [missingNote(missing)] : []),
    ...(skippedStart ? [`Started item ${started} only: work one item at a time and mark it done before starting the next.`] : []),
  ];
  if (changes.length === 0) {
    return { ok: true, lead: `No change: the patch changed nothing.${notes.map((n) => ` ${n}`).join("")}\n`, changes };
  }
  const head = `Applied ${plural(changes.length, "change")}.`;
  return { ok: true, lead: `${[head, ...notes].join(" ")}\n`, changes };
}
