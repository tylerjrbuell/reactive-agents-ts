import type { ChecklistSnapshotWire } from "@reactive-agents/ui-core";

/** Status of one conversation to-do row (the persisted shape; `done` in the live checklist is `completed` here). */
export type TodoStatus = "pending" | "in_progress" | "completed";

/** One row of the conversation-level to-do list. */
export interface TodoItem {
  readonly id: string;
  readonly title: string;
  readonly status: TodoStatus;
}

/**
 * Fold a live checklist snapshot into the conversation list: the root group's advisory rows
 * ARE the list (the engine seeds every turn from it, so a snapshot always carries it whole).
 * Mirrors the server's `snapshotToTodoSeed`; requirement rows and sub-agent groups never count.
 */
export function todoFromChecklist(snapshot: ChecklistSnapshotWire): TodoItem[] {
  return snapshot.root.rows.flatMap((r): TodoItem[] =>
    r.kind === "advisory"
      ? [{ id: r.id, title: r.title, status: r.status === "done" ? "completed" : r.status === "in_progress" ? "in_progress" : "pending" }]
      : [],
  );
}

/** Display model for the dock. */
export interface TodoDockView {
  readonly empty: boolean;
  readonly done: number;
  readonly total: number;
  /** First in-progress row: the single "now doing" line. */
  readonly current: TodoItem | undefined;
  readonly allDone: boolean;
  /** Collapsed pill text, e.g. "To-do 2/5 · Write the report". */
  readonly header: string;
  readonly progressPct: number;
}

/** Project the list onto the dock's counts and header. */
export function todoDockView(items: readonly TodoItem[]): TodoDockView {
  const total = items.length;
  const done = items.filter((i) => i.status === "completed").length;
  const current = items.find((i) => i.status === "in_progress");
  return {
    empty: total === 0,
    done,
    total,
    current,
    allDone: total > 0 && done === total,
    header: total === 0 ? "" : `To-do ${done}/${total}${current ? ` · ${current.title}` : ""}`,
    progressPct: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/** What the dock renders: the full dock, a slim "+ To-do" add affordance (empty list, tool enabled), or nothing. */
export function todoDockMode(items: readonly TodoItem[], toolEnabled: boolean): "full" | "empty" | "hidden" {
  if (items.length > 0) return "full";
  return toolEnabled ? "empty" : "hidden";
}

/** True only when the session config explicitly enables the `todo` meta-tool. */
export function todoToolEnabled(agentConfig: Readonly<Record<string, unknown>>): boolean {
  const mt = agentConfig.metaTools;
  return typeof mt === "object" && mt !== null && (mt as Record<string, unknown>).todo === true;
}

/** Click on a row: completed goes back to pending, anything else becomes completed. */
export function toggleTodo(items: readonly TodoItem[], id: string): TodoItem[] {
  return items.map((i) => (i.id === id ? { ...i, status: i.status === "completed" ? "pending" : "completed" } : i));
}

/** Append a pending row; ids stay stable and continue the numeric sequence (matches the engine's numbering). */
export function addTodo(items: readonly TodoItem[], title: string): TodoItem[] {
  const text = title.trim();
  if (text.length === 0) return [...items];
  const max = items.reduce((m, i) => (/^\d+$/.test(i.id) ? Math.max(m, Number(i.id)) : m), 0);
  return [...items, { id: String(max + 1), title: text, status: "pending" }];
}

/** Drop finished rows; the rest keep their ids. */
export function clearCompleted(items: readonly TodoItem[]): TodoItem[] {
  return items.filter((i) => i.status !== "completed");
}

/** Remove one row. */
export function removeTodo(items: readonly TodoItem[], id: string): TodoItem[] {
  return items.filter((i) => i.id !== id);
}
