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
 */
import { nextAdvisoryIds } from "@reactive-agents/core";
import type { AdvisoryItem, ChecklistItemOp, ChecklistItemStatus } from "@reactive-agents/core";
import type { ToolDefinition } from "../types.js";
import { closestValid, healParamNames } from "./arg-healing.js";
import { hasTodoTargets, resolveTodoTargets } from "./todo-targets.js";

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
  show: "list",
  status: "list",
};

/**
 * Context-dependent actions: models say "update"/"set" for both "here is my
 * list" (items present) and "change this item's status" (id + status). The
 * target is decided from the arguments, never guessed from the verb alone.
 */
const TODO_UPDATE_VERBS: ReadonlySet<string> = new Set([
  "update", "set", "replace", "write", "save", "modify", "mark",
]);

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

/** Accepted alternates per canonical parameter (canonical present => alternates ignored). */
const TODO_PARAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  items: ["item", "tasks", "task", "todos", "steps", "text"],
  id: ["index", "number", "n"],
};
// start/done targets (id | ids | item | index | number | n, number|string|"1,2"|array|title)
// are resolved by ./todo-targets.ts from the healed args.

const TODO_VALID_ACTIONS = ["add", "start", "done", "list"] as const;

/**
 * Pure: map a raw `action` to its canonical form via the closed alias table
 * (case/whitespace tolerant). `healedFrom` carries the raw input only when an
 * alias was applied. Unknown strings pass through unchanged.
 */
export function normalizeTodoAction(raw: string): { readonly action: string; readonly healedFrom?: string } {
  const key = raw.trim().toLowerCase();
  const canonical = Object.prototype.hasOwnProperty.call(TODO_ACTION_ALIASES, key)
    ? TODO_ACTION_ALIASES[key]
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

const norm = (t: string): string => t.trim().replace(/\s+/g, " ").toLowerCase();

const CLOSING_OPEN = (n: number, firstId: string): string =>
  `Open: ${n}. Mark progress: todo({action:"done", id:${firstId}}) when finished ` +
  `(todo({action:"start", id:${firstId}}) when you begin). Do not give your final answer while items are open.`;

/** The loop-closing line: always the last line of a todo result. */
function closingLine(items: readonly AdvisoryItem[], posture: TodoPosture = "execute"): string {
  if (posture === "plan") {
    return items.length === 0
      ? "No plan recorded yet. Record the plan with todo add, then present it to the user and stop; do not start work."
      : `Plan recorded (${items.length} ${items.length === 1 ? "item" : "items"}). Present the plan to the user and stop; do not start work.`;
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
 */
export function applyTodoChecklistAction(
  items: readonly AdvisoryItem[],
  args: Record<string, unknown>,
  posture: TodoPosture = "execute",
): TodoChecklistResult {
  const { args: healedArgs } = healParamNames(args, TODO_PARAM_ALIASES);
  const rawAction = typeof args.action === "string" ? args.action : "list";
  const key = rawAction.trim().toLowerCase();

  let action: string;
  let healedFrom: string | undefined;
  let status: ChecklistItemStatus | undefined;
  if (TODO_UPDATE_VERBS.has(key)) {
    const hasItems = extractTexts(healedArgs.items).length > 0;
    const statusWord = typeof healedArgs.status === "string" ? healedArgs.status.trim().toLowerCase() : "";
    const mapped = Object.prototype.hasOwnProperty.call(TODO_STATUS_ALIASES, statusWord)
      ? TODO_STATUS_ALIASES[statusWord]
      : undefined;
    if (hasItems) {
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

  const out = applyCanonicalTodoAction(items, healedArgs, action, { status, posture });
  const rendered = `${out.rendered}\n${closingLine(out.finalItems, posture)}`;
  const result: TodoChecklistResult = { rendered, ok: out.ok, changes: out.changes };
  return healedFrom === undefined
    ? result
    : { ...result, healedFrom, healedTo: action === "set-status" ? "status" : action };
}

function applyChanges(items: readonly AdvisoryItem[], changes: readonly ChecklistItemOp[]): readonly AdvisoryItem[] {
  let next = items;
  for (const c of changes) {
    if (c.op === "status") next = next.map((t) => (t.id === c.id ? { ...t, status: c.status } : t));
  }
  return next;
}

function applyCanonicalTodoAction(
  items: readonly AdvisoryItem[],
  args: Record<string, unknown>,
  action: string,
  opts: { readonly status?: ChecklistItemStatus; readonly posture?: TodoPosture },
): CanonicalOutcome {
  const posture = opts.posture ?? "execute";
  const fail = (rendered: string): CanonicalOutcome => ({ rendered, ok: false, changes: [], finalItems: items });
  switch (action) {
    case "add": {
      let texts = extractTexts(args.items);
      if (texts.length === 0) {
        return fail(`No items provided. Usage: todo({action:"add", items:["step 1","step 2"]})\n${renderTodoChecklist(items, posture)}`);
      }
      // Every add skips titles already on the list (any status) or repeated in
      // this call: models re-send the whole list each turn.
      const seen = new Set(items.map((t) => norm(t.title)));
      const requested = texts.length;
      texts = texts.filter((t) => {
        const k = norm(t);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const skipped = requested - texts.length;
      const skipNote = skipped > 0 ? `Skipped ${skipped} duplicate item(s): already on the list.\n` : "";
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
      const ids = nextAdvisoryIds(items, texts.length);
      const added = texts.map((title, i) => ({ id: ids[i] as string, title }));
      const next: AdvisoryItem[] = [
        ...items,
        ...added.map((a, i) => ({
          id: a.id,
          seq: Number(ids[i]),
          title: a.title,
          status: "pending" as const,
        })),
      ];
      return { rendered: `${skipNote}${renderTodoChecklist(next, posture)}`, ok: true, changes: [{ op: "add", items: added }], finalItems: next };
    }
    case "start":
    case "done":
    case "set-status": {
      const resolved = resolveTodoTargets(items, args);
      if (!resolved.ok) return fail(`${resolved.error}\n${renderTodoChecklist(items, posture)}`);
      const status: ChecklistItemStatus =
        action === "set-status" ? (opts.status as ChecklistItemStatus) : action === "done" ? "completed" : "in_progress";
      const changes: readonly ChecklistItemOp[] = resolved.ids.flatMap((id): ChecklistItemOp[] =>
        items.find((t) => t.id === id)?.status === status ? [] : [{ op: "status", id, status }],
      );
      const next = applyChanges(items, changes);
      return { rendered: renderTodoChecklist(next, posture), ok: true, changes, finalItems: next };
    }
    case "list":
      return { rendered: renderTodoChecklist(items, posture), ok: true, changes: [], finalItems: items };
    default: {
      const near = closestValid(action, TODO_VALID_ACTIONS);
      const example =
        near === "add"
          ? `todo({action:"add", items:["step 1","step 2"]})`
          : near === "list"
            ? `todo({action:"list"})`
            : `todo({action:"${near}", id:N})`;
      return fail(
        `Unknown action "${action}". Valid: add | start | done | list.\n` +
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
    "Mark it done immediately after finishing it with todo({action:'done', id:N}); before your final answer make sure no item is left open.",
  parameters: [
    {
      name: "action",
      type: "string",
      description: "add | start | done | list",
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
      description: "For 'start'/'done': the item id to update.",
      required: false,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function",
  category: "data",
};
