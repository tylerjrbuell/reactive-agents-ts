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

/** Result of one todo action over ledger-folded advisory items. */
export interface TodoChecklistResult {
  /** Rendered view returned to the model. */
  readonly rendered: string;
  readonly ok: boolean;
  /** Ledger changes to commit; empty for `list`, errors, and same-status no-ops. */
  readonly changes: readonly ChecklistItemOp[];
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
export function renderTodoChecklist(items: readonly AdvisoryItem[]): string {
  if (items.length === 0) {
    return "Todo list is empty. Call todo with action 'add' and items to plan your task.";
  }
  const lines = items.map((t) => `${ADVISORY_ICON[t.status]} ${t.id}. ${t.title}`);
  const doneCount = items.filter((t) => t.status === "completed").length;
  return [
    `Todo (${doneCount}/${items.length} done):`,
    ...lines,
    doneCount === items.length
      ? "All items done — deliver your final answer now."
      : "Work the first unchecked item next. Mark items done as you complete them.",
  ].join("\n");
}

/**
 * Pure todo action over advisory items (a fold of ledger facts). Returns the
 * rendered view plus the ledger `changes` to commit. Never throws.
 */
export function applyTodoChecklistAction(
  items: readonly AdvisoryItem[],
  args: Record<string, unknown>,
): TodoChecklistResult {
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
        return {
          rendered: `No items provided. Usage: todo({action:"add", items:["step 1","step 2"]})\n${renderTodoChecklist(items)}`,
          ok: false,
          changes: [],
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
      return { rendered: renderTodoChecklist(next), ok: true, changes: [{ op: "add", items: added }] };
    }
    case "start":
    case "done": {
      const id = String(Number(args.id));
      const target = items.find((t) => t.id === id);
      if (!target) {
        return { rendered: `No todo item with id ${String(args.id)}.\n${renderTodoChecklist(items)}`, ok: false, changes: [] };
      }
      const status: ChecklistItemStatus = action === "done" ? "completed" : "in_progress";
      const next = items.map((t) => (t.id === id ? { ...t, status } : t));
      return {
        rendered: renderTodoChecklist(next),
        ok: true,
        changes: target.status === status ? [] : [{ op: "status", id, status }],
      };
    }
    case "list":
      return { rendered: renderTodoChecklist(items), ok: true, changes: [] };
    default:
      return {
        rendered: `Unknown action "${action}". Valid: add | start | done | list.\n${renderTodoChecklist(items)}`,
        ok: false,
        changes: [],
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
