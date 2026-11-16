/**
 * skills/todo.ts — universal task-tracking meta-tool (P6a, 2026-07-07).
 *
 * Leading-harness practice (A4): an externalized, model-updatable checklist
 * keeps long multi-step tasks on track across every strategy — RA's Plan type
 * was locked inside plan-execute, leaving react/reflexion/code-action with no
 * task-tracking rail at all. The todo tool is strategy-agnostic: the model
 * decomposes its task once, then checks items off as it completes them, and
 * every response renders the full list so drift is visible immediately.
 *
 * Pure core: `applyTodoChecklistAction` maps (ledger-folded items, args) →
 * (rendered view, ledger changes). Persistence lives with the caller (the
 * kernel meta-tool handler commits changes as checklist-item facts).
 * List management (edit, remove, clear, patch): ./todo-manage.ts.
 */
import type { AdvisoryItem, ChecklistItemOp, ChecklistItemStatus } from "@reactive-agents/core";
import type { ToolDefinition } from "../types.js";
import { closestValid, healParamNames } from "./arg-healing.js";
import { hasTodoTargets, resolveTodoTargets } from "./todo-targets.js";
import {
  applyTodoOps,
  clearTodoItems,
  editTodoItem,
  nextTodoIds,
  patchTodoItems,
  removeTodoItems,
  todoStatusOf,
  type TodoManageOutcome,
} from "./todo-manage.js";

/**
 * Run posture for the todo result text. Structural mirror of the core
 * `RunPosture` type (not yet exported from @reactive-agents/core); `execute`
 * is the default and byte-identical to the pre-posture output.
 */
export type TodoPosture = "execute" | "plan";

/** Result of one todo action over ledger-folded advisory items. */
export interface TodoChecklistResult {
  /** Rendered view returned to the model. */
  readonly rendered: string;
  readonly ok: boolean;
  /** Ledger changes to commit; empty for `list`, errors, and same-status no-ops. */
  readonly changes: readonly ChecklistItemOp[];
  /** Original `action` string when it was healed via the alias table; absent for canonical calls. */
  readonly healedFrom?: string;
  /** Canonical action the healed call resolved to (e.g. "add"); present iff `healedFrom` is. */
  readonly healedTo?: string;
}

/** Closed alias table: observed model-invented action names -> canonical action. */
const TODO_ACTION_ALIASES: Readonly<Record<string, string>> = {
  create: "add",
  new: "add",
  plan: "add",
  // census 2026-11-10: `create_list` observed live
  create_list: "add",
  "create-list": "add",
  add_items: "add",
  "add-items": "add",
  mark_done: "done",
  complete: "done",
  completed: "done",
  finish: "done",
  check: "done",
  tick: "done",
  close: "done",
  "mark-done": "done",
  markdone: "done",
  finished: "done",
  begin: "start",
  in_progress: "start",
  working: "start",
  undo: "reopen",
  "re-open": "reopen",
  re_open: "reopen",
  uncheck: "reopen",
  show: "list",
  status: "list",
  view: "list",
  get: "list",
  delete: "remove",
  rm: "remove",
  del: "remove",
  rename: "edit",
  retitle: "edit",
  "update-text": "edit",
  update_text: "edit",
  reset: "clear",
  clear_all: "clear",
  "clear-all": "clear",
  batch: "patch",
};

/** Verbs that mean "clear only the done items": healed to `clear` with status `completed`. */
const TODO_CLEAR_DONE_VERBS: ReadonlySet<string> = new Set([
  "clear_completed", "clear-completed", "clear_done", "clear-done",
]);

/**
 * Context-dependent actions: models say "update"/"set" for both "here is my
 * list" (items present) and "change this item's status" (id + status). The
 * target is decided from the arguments, never guessed from the verb alone.
 */
const TODO_UPDATE_VERBS: ReadonlySet<string> = new Set([
  "update", "set", "replace", "write", "save", "modify", "mark",
]);

/** Accepted alternates per canonical parameter (canonical present => alternates ignored). */
const TODO_PARAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  items: ["item", "tasks", "task", "todos", "steps", "text"],
  id: ["index", "number", "n"],
};
// start/done targets (id | ids | item | index | number | n, number|string|"1,2"|array|title)
// are resolved by ./todo-targets.ts from the healed args.

const TODO_VALID_ACTIONS = ["add", "start", "done", "reopen", "edit", "remove", "clear", "patch", "list"] as const;

/** Example call per action whose shape is not `todo({action, id:N})`, for the unknown-action teaching. */
const TODO_EXAMPLES: Readonly<Record<string, string>> = {
  add: `todo({action:"add", items:["step 1","step 2"]})`,
  list: `todo({action:"list"})`,
  edit: `todo({action:"edit", id:N, text:"new title"})`,
  clear: `todo({action:"clear"})`,
  patch: `todo({action:"patch", ops:[{id:N, status:"done"}, {remove:N}]})`,
};

/**
 * Pure: map a raw `action` to its canonical form via the closed alias table
 * (case/whitespace tolerant). `healedFrom` carries the raw input only when an
 * alias was applied. Unknown strings pass through unchanged.
 */
export function normalizeTodoAction(raw: string): { readonly action: string; readonly healedFrom?: string } {
  const key = raw.trim().toLowerCase();
  const canonical = Object.prototype.hasOwnProperty.call(TODO_ACTION_ALIASES, key)
    ? TODO_ACTION_ALIASES[key]
    : key !== raw && (TODO_VALID_ACTIONS as readonly string[]).includes(key)
      ? key // `Done`, ` list ` — the canonical verb in another case or padding
      : undefined;
  return canonical !== undefined ? { action: canonical, healedFrom: raw } : { action: raw };
}

const ADVISORY_ICON: Record<ChecklistItemStatus, string> = {
  pending: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

/**
 * Render advisory items as the todo checklist view. Output format is frozen
 * (pinned against the legacy oracle in tests).
 */
export function renderTodoChecklist(items: readonly AdvisoryItem[], posture: TodoPosture = "execute"): string {
  if (items.length === 0) {
    return "Todo list is empty. Call todo with action 'add' and items to plan your task.";
  }
  const lines = items.map((t) => `${ADVISORY_ICON[t.status]} ${t.id}. ${t.title}`);
  const doneCount = items.filter((t) => t.status === "completed").length;
  if (posture === "plan") return [`Todo (${doneCount}/${items.length} done):`, ...lines].join("\n");
  return [
    `Todo (${doneCount}/${items.length} done):`,
    ...lines,
    doneCount === items.length
      ? "All items done — deliver your final answer now."
      : "Work the first unchecked item next. Mark items done as you complete them.",
  ].join("\n");
}

/** Dedupe key: trim, collapse whitespace, case-fold, drop trailing sentence punctuation / ellipsis. */
const norm = (t: string): string =>
  t.trim().replace(/\s+/g, " ").toLowerCase().replace(/[\s.…!]+$/u, "");

const CLOSING_OPEN = (n: number, firstId: string): string =>
  `Open: ${n}. Mark progress: todo({action:"done", id:${firstId}}) when finished ` +
  `(todo({action:"start", id:${firstId}}) when you begin). Do not give your final answer while items are open.`;

/** The loop-closing line: always the last line of a todo result. */
function closingLine(items: readonly AdvisoryItem[], posture: TodoPosture = "execute"): string {
  if (posture === "plan") {
    return items.length === 0
      ? "No plan recorded yet. Record the plan with todo add, then present it to the user."
      : `Plan recorded (${items.length} ${items.length === 1 ? "step" : "steps"}). Present it to the user; execution starts from this list.`;
  }
  if (items.length === 0) return "Open: 0. Plan the task with todo add when it has 3+ steps.";
  const open = items.filter((t) => t.status !== "completed");
  const first = open[0];
  return first === undefined ? "All items done." : CLOSING_OPEN(open.length, first.id);
}

interface CanonicalOutcome extends TodoChecklistResult {
  /** Ledger-folded items AFTER applying `changes` (drives the closing line). */
  readonly finalItems: readonly AdvisoryItem[];
}

function extractTexts(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : typeof raw === "string"
      ? raw.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];
}

/**
 * Pure todo action over advisory items (a fold of ledger facts). Returns the
 * rendered view plus the ledger `changes` to commit. Never throws. Heals drifted
 * action verbs, parameter names and status words (closed tables); every result
 * ends with an explicit loop-closing line.
 *
 * `history` is every checklist op the items were folded from (committed and
 * staged). `add` issues ids after the highest id in it, so an id freed by
 * `remove` or `clear` is never issued again. Without it, ids continue after
 * the current items only.
 */
export function applyTodoChecklistAction(
  items: readonly AdvisoryItem[],
  args: Record<string, unknown>,
  posture: TodoPosture = "execute",
  history: readonly ChecklistItemOp[] = [],
): TodoChecklistResult {
  const { args: healedArgs } = healParamNames(args, TODO_PARAM_ALIASES);
  const rawAction = typeof args.action === "string" ? args.action : "list";
  const key = rawAction.trim().toLowerCase();

  let action: string;
  let healedFrom: string | undefined;
  let status: ChecklistItemStatus | undefined;
  const newTitle = typeof (args.text ?? args.title) === "string" && args.items == null && args.item == null;
  if (TODO_CLEAR_DONE_VERBS.has(key)) {
    action = "clear";
    status = "completed";
    healedFrom = rawAction;
  } else if (TODO_UPDATE_VERBS.has(key)) {
    const hasItems = extractTexts(healedArgs.items).length > 0;
    const mapped = todoStatusOf(healedArgs.status);
    if (newTitle && healedArgs.id != null && mapped === undefined) {
      // `update {id, text}` renames the item; without an id the text is new items.
      action = "edit";
      healedFrom = rawAction;
    } else if (hasItems) {
      action = "add";
      healedFrom = rawAction;
    } else if (hasTodoTargets(healedArgs) && mapped !== undefined) {
      action = "set-status";
      status = mapped;
      healedFrom = rawAction;
    } else {
      action = rawAction; // unknown: teach below
    }
  } else {
    const n = normalizeTodoAction(rawAction);
    action = n.action;
    healedFrom = n.healedFrom;
  }

  const out = applyCanonicalTodoAction(items, healedArgs, action, { status, posture, history });
  const rendered = `${out.rendered}\n${closingLine(out.finalItems, posture)}`;
  const result: TodoChecklistResult = { rendered, ok: out.ok, changes: out.changes };
  return healedFrom === undefined
    ? result
    : { ...result, healedFrom, healedTo: action === "set-status" ? "status" : action };
}

/**
 * One item in progress at a time: of the requested ids, keep the one already
 * in progress, else the first pending one, else the first requested.
 */
function oneToStart(items: readonly AdvisoryItem[], ids: readonly string[]): readonly string[] {
  const statusOf = (id: string): ChecklistItemStatus | undefined => items.find((t) => t.id === id)?.status;
  const pick = ids.find((id) => statusOf(id) === "in_progress") ?? ids.find((id) => statusOf(id) === "pending") ?? ids[0];
  return pick === undefined ? [] : [pick];
}

/**
 * The first line of a start/done call that changed nothing: says so and names
 * the next concrete step, so a repeated identical call is not read as progress.
 */
function noChangeLine(
  items: readonly AdvisoryItem[],
  ids: readonly string[],
  status: ChecklistItemStatus,
  posture: TodoPosture,
): string {
  const first = ids[0];
  if (first === undefined) return "No change: every item is done — deliver your final answer.";
  const which = ids.length === 1 ? `item ${first} is` : `items ${ids.join(", ")} are`;
  if (status === "in_progress") {
    return posture === "plan"
      ? `No change: ${which} already in progress.`
      : `No change: ${which} already in progress — do its work now with a tool, then todo({action:"done", id:${first}}).`;
  }
  if (status === "pending") return `No change: ${which} already pending.`;
  const open = items.find((t) => t.status !== "completed");
  return (
    `No change: ${which} already done. ` +
    (open === undefined ? "All items are done — deliver your final answer." : `Next: todo({action:"start", id:${open.id}}).`)
  );
}

/** The no-op lead line of a `reopen` whose targets are all still open. */
function reopenNoChangeLine(ids: readonly string[]): string {
  const which = ids.length === 1 ? `item ${ids[0]} is` : `items ${ids.join(", ")} are`;
  return `No change: ${which} not done, so there is nothing to reopen.`;
}

function applyCanonicalTodoAction(
  items: readonly AdvisoryItem[],
  args: Record<string, unknown>,
  action: string,
  opts: {
    readonly status?: ChecklistItemStatus;
    readonly posture?: TodoPosture;
    readonly history?: readonly ChecklistItemOp[];
  },
): CanonicalOutcome {
  const posture = opts.posture ?? "execute";
  const fail = (rendered: string): CanonicalOutcome => ({ rendered, ok: false, changes: [], finalItems: items });
  const managed = (out: TodoManageOutcome): CanonicalOutcome => {
    const next = applyTodoOps(items, out.changes);
    return { rendered: `${out.lead}${renderTodoChecklist(next, posture)}`, ok: out.ok, changes: out.changes, finalItems: next };
  };
  switch (action) {
    case "edit":
      return managed(editTodoItem(items, args));
    case "remove":
      return managed(removeTodoItems(items, args));
    case "clear":
      return managed(clearTodoItems(items, opts.status ?? args.status));
    case "patch":
      return managed(patchTodoItems(items, args.ops));
    case "add": {
      let texts = extractTexts(args.items);
      if (texts.length === 0) {
        return fail(`No items provided. Usage: todo({action:"add", items:["step 1","step 2"]})\n${renderTodoChecklist(items, posture)}`);
      }
      // Every add skips titles already on the list (any status) or repeated in
      // this call: models re-send the whole list each turn.
      const seen = new Map<string, AdvisoryItem | undefined>(items.map((t) => [norm(t.title), t]));
      const requested = texts.length;
      const dupLines: string[] = [];
      texts = texts.filter((t) => {
        const k = norm(t);
        if (seen.has(k)) {
          const hit = seen.get(k);
          dupLines.push(
            hit === undefined
              ? "Repeated in this call; not added."
              : `Already on the list as #${hit.id} (${hit.status === "completed" ? "done" : "open"}); not added.`,
          );
          return false;
        }
        seen.set(k, undefined);
        return true;
      });
      const skipped = requested - texts.length;
      const skipNote = skipped > 0 ? `Skipped ${skipped} duplicate item(s): already on the list.\n${dupLines.join("\n")}\n` : "";
      if (texts.length === 0) {
        return {
          rendered:
            posture === "plan"
              ? `${skipNote}Nothing new added: these are already on the plan.\n${renderTodoChecklist(items, posture)}`
              : `${skipNote}Nothing new added: these are already on the list. To record progress call ` +
                `todo({action:"done", id:N}) (or start).\n${renderTodoChecklist(items)}`,
          ok: true,
          changes: [],
          finalItems: items,
        };
      }
      const ids = nextTodoIds(items, opts.history ?? [], texts.length);
      const added = texts.map((title, i) => ({ id: ids[i] as string, title }));
      const changes: readonly ChecklistItemOp[] = [{ op: "add", items: added }];
      const next = applyTodoOps(items, changes);
      return { rendered: `${skipNote}${renderTodoChecklist(next, posture)}`, ok: true, changes, finalItems: next };
    }
    case "start":
    case "done":
    case "reopen":
    case "set-status": {
      // `start` with no target means "begin the next item": the first open one.
      const resolved =
        action === "start" && !hasTodoTargets(args) && items.length > 0
          ? { ok: true as const, ids: items.filter((t) => t.status !== "completed").slice(0, 1).map((t) => t.id) }
          : resolveTodoTargets(items, args);
      if (!resolved.ok) return fail(`${resolved.error}\n${renderTodoChecklist(items, posture)}`);
      const status: ChecklistItemStatus =
        action === "set-status"
          ? (opts.status as ChecklistItemStatus)
          : action === "done" ? "completed" : action === "reopen" ? "pending" : "in_progress";
      const ids = status === "in_progress" ? oneToStart(items, resolved.ids) : resolved.ids;
      // `reopen` only puts done items back; it never demotes an item in progress.
      const statusOf = (id: string): ChecklistItemStatus | undefined => items.find((t) => t.id === id)?.status;
      const changes: readonly ChecklistItemOp[] = ids.flatMap((id): ChecklistItemOp[] =>
        statusOf(id) === status || (action === "reopen" && statusOf(id) !== "completed") ? [] : [{ op: "status", id, status }],
      );
      const next = applyTodoOps(items, changes);
      const lead =
        changes.length === 0
          ? `${action === "reopen" ? reopenNoChangeLine(ids) : noChangeLine(items, ids, status, posture)}\n`
          : ids.length < resolved.ids.length
            ? `Started item ${ids[0]} only: work one item at a time and mark it done before starting the next.\n`
            : "";
      return { rendered: `${lead}${renderTodoChecklist(next, posture)}`, ok: true, changes, finalItems: next };
    }
    case "list":
      return { rendered: renderTodoChecklist(items, posture), ok: true, changes: [], finalItems: items };
    default: {
      const near = closestValid(action, TODO_VALID_ACTIONS);
      const example = TODO_EXAMPLES[near] ?? `todo({action:"${near}", id:N})`;
      return fail(
        `Unknown action "${action}". Valid: ${TODO_VALID_ACTIONS.join(" | ")}.\n` +
          `Closest valid call: ${example}\n${renderTodoChecklist(items, posture)}`,
      );
    }
  }
}

export const todoTool: ToolDefinition = {
  name: "todo",
  description:
    "Your task checklist. Plan once with todo({action:'add', items:['step 1','step 2',...]}); " +
    "set the item you are working on with todo({action:'start', id:N}). " +
    "Mark it done immediately after finishing it with todo({action:'done', id:N}); before your final answer make sure no item is left open. " +
    "Put a done item back with todo({action:'reopen', id:N}). " +
    "Fix the list when the plan changes: todo({action:'edit', id:N, text:'new title'}), todo({action:'remove', ids:[N]}), " +
    "todo({action:'clear'}) (add status:'completed' to clear only done items), or several changes at once with " +
    "todo({action:'patch', ops:[{id:N, text:'...'}, {id:N, status:'done'}, {remove:N}]}).",
  parameters: [
    {
      name: "action",
      type: "string",
      description: "add | start | done | reopen | edit | remove | clear | patch | list",
      // The value set lives in `enum`: compact profiles drop descriptions from
      // the wire, and a bare `action: string` let a model send its task title
      // as the action (trace 01M744TPCB87CHKCDPE964YBAP). Off-enum words are
      // still healed by the handler's alias table (todo runs inline, not
      // through the input validator).
      enum: [...TODO_VALID_ACTIONS],
      required: true,
    },
    {
      name: "items",
      type: "array",
      description: "For 'add': list of step descriptions.",
      required: false,
    },
    {
      name: "id",
      type: "number",
      description: "For 'start'/'done'/'reopen'/'edit'/'remove': the item id.",
      required: false,
    },
    { name: "ids", type: "array", items: { type: "number" }, description: "Several item ids at once.", required: false },
    { name: "text", type: "string", description: "For 'edit': the new item title.", required: false },
    {
      name: "status",
      type: "string",
      description: "For 'clear': clear only the items with this status.",
      enum: ["pending", "in_progress", "completed"],
      required: false,
    },
    {
      // A JSON string, not an array of objects: `items` cannot declare object
      // properties, and an object without them becomes `properties: {}`, which
      // OpenAI strict mode reads as "empty objects only". The handler also
      // accepts a real array.
      name: "ops",
      type: "string",
      description:
        "For 'patch': JSON array of changes applied in order; {id, text} renames, {id, status} sets status, " +
        `{remove: id} deletes. Example: [{"id":1,"text":"new title"},{"id":2,"status":"done"},{"remove":3}]`,
      required: false,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  mutatesExternalState: false,
  source: "function",
  category: "data",
};
