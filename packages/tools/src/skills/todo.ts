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
 * Pure core: `applyTodoAction` maps (serialized list, args) → (new list,
 * rendered view). Persistence and per-run scoping live with the caller (the
 * kernel meta-tool handler keys the shared scratchpad by taskId).
 */
import type { ToolDefinition } from "../types.js";

export interface TodoItem {
  readonly id: number;
  readonly text: string;
  readonly status: "pending" | "in_progress" | "done";
}

export interface TodoActionResult {
  /** New list state (serialize + store). */
  readonly list: readonly TodoItem[];
  /** Rendered view returned to the model. */
  readonly rendered: string;
  readonly ok: boolean;
}

const STATUS_ICON: Record<TodoItem["status"], string> = {
  pending: "[ ]",
  in_progress: "[~]",
  done: "[x]",
};

export function renderTodoList(list: readonly TodoItem[]): string {
  if (list.length === 0) {
    return "Todo list is empty. Call todo with action 'add' and items to plan your task.";
  }
  const lines = list.map((t) => `${STATUS_ICON[t.status]} ${t.id}. ${t.text}`);
  const doneCount = list.filter((t) => t.status === "done").length;
  return [
    `Todo (${doneCount}/${list.length} done):`,
    ...lines,
    doneCount === list.length
      ? "All items done — deliver your final answer now."
      : "Work the first unchecked item next. Mark items done as you complete them.",
  ].join("\n");
}

export function parseTodoList(serialized: string | undefined): TodoItem[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is TodoItem =>
        typeof t === "object" && t !== null &&
        typeof (t as TodoItem).id === "number" &&
        typeof (t as TodoItem).text === "string" &&
        ["pending", "in_progress", "done"].includes((t as TodoItem).status),
    );
  } catch {
    return [];
  }
}

/**
 * Apply one todo action. Unknown/malformed input degrades to a rendered
 * usage hint with `ok: false` — never throws.
 */
export function applyTodoAction(
  serialized: string | undefined,
  args: Record<string, unknown>,
): TodoActionResult {
  const list = parseTodoList(serialized);
  const action = typeof args.action === "string" ? args.action : "list";

  switch (action) {
    case "add": {
      const raw = args.items ?? args.item ?? args.text;
      const texts = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string")
        : typeof raw === "string"
          ? raw.split("\n").map((s) => s.trim()).filter(Boolean)
          : [];
      if (texts.length === 0) {
        return { list, rendered: `No items provided. Usage: todo({action:"add", items:["step 1","step 2"]})\n${renderTodoList(list)}`, ok: false };
      }
      let nextId = list.reduce((m, t) => Math.max(m, t.id), 0) + 1;
      const added = texts.map((text) => ({ id: nextId++, text, status: "pending" as const }));
      const next = [...list, ...added];
      return { list: next, rendered: renderTodoList(next), ok: true };
    }
    case "start":
    case "done": {
      const id = typeof args.id === "number" ? args.id : Number(args.id);
      const target = list.find((t) => t.id === id);
      if (!target) {
        return { list, rendered: `No todo item with id ${String(args.id)}.\n${renderTodoList(list)}`, ok: false };
      }
      const status = action === "done" ? ("done" as const) : ("in_progress" as const);
      const next = list.map((t) => (t.id === id ? { ...t, status } : t));
      return { list: next, rendered: renderTodoList(next), ok: true };
    }
    case "list":
      return { list, rendered: renderTodoList(list), ok: true };
    default:
      return {
        list,
        rendered: `Unknown action "${action}". Valid: add | start | done | list.\n${renderTodoList(list)}`,
        ok: false,
      };
  }
}

export const todoTool: ToolDefinition = {
  name: "todo",
  description:
    "Your task checklist — plan multi-step work and track progress. " +
    "Call todo({action:'add', items:['step 1','step 2',...]}) ONCE at the start of any task with 3+ distinct steps, " +
    "then todo({action:'done', id:N}) as you finish each item. " +
    "todo({action:'start', id:N}) marks an item in progress; todo({action:'list'}) shows current state. " +
    "Every call returns the full checklist so you always know what remains. " +
    "Finish every item (or explicitly note why one is unmeetable) before delivering your final answer.",
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
