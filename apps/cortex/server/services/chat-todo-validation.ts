import type { StoredTodoItem } from "../db/chat-queries.js";

const TODO_MAX_ITEMS = 100;
const TODO_STATUS_SET: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"]);

/** Validate + normalise a user-supplied to-do list: stable unique ids, non-empty titles, known statuses. */
export function validateTodo(items: readonly StoredTodoItem[]): StoredTodoItem[] {
  if (!Array.isArray(items) || items.length > TODO_MAX_ITEMS) throw new Error("Invalid to-do list");
  const seen = new Set<string>();
  return items.map((it) => {
    const id = typeof it?.id === "string" ? it.id.trim() : "";
    const title = typeof it?.title === "string" ? it.title.trim() : "";
    if (!id || !title || !TODO_STATUS_SET.has(it.status) || seen.has(id)) throw new Error("Invalid to-do list item");
    seen.add(id);
    return { id, title, status: it.status };
  });
}
