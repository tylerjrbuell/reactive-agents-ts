/**
 * skills/todo-add.ts — input shaping and duplicate detection for `todo add`.
 *
 * Pure; never throws. `extractAddItems` accepts the plain `["step"]` shape plus
 * a structured per-item tool (`[{text, tool}]` or a parallel `tools` array);
 * the rephrase-tolerant dedupe the add path applies after its exact-title check
 * is core's `isNearDuplicateTitle`.
 */

/** One step to add, with the tool the model expects to use for it (absent = none). */
export interface TodoAddItem {
  readonly text: string;
  readonly tool?: string;
}

/** Clean a model-supplied tool name: trim, drop a leading `tool:` label; `undefined` when empty. */
export function normalizeTodoTool(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().replace(/^tool\s*:\s*/i, "").trim();
  return t.length > 0 ? t : undefined;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Items to add from raw `items` (+ optional parallel `tools`). Entries are a
 * string or an object with `text` (or `title`/`step`/`task`) and an optional
 * `tool`. A newline-separated string splits into items. A single `tools` string
 * applies to a single item.
 */
export function extractAddItems(rawItems: unknown, rawTools?: unknown): TodoAddItem[] {
  const parallel: readonly unknown[] = Array.isArray(rawTools) ? rawTools : rawTools === undefined ? [] : [rawTools];
  const out: TodoAddItem[] = [];
  // Titles pass through untouched (legacy contract: a plain string entry is
  // kept verbatim, even empty); only the newline-split form trims.
  const push = (text: string, tool: unknown): void => {
    const name = normalizeTodoTool(tool);
    out.push(name === undefined ? { text } : { text, tool: name });
  };
  if (typeof rawItems === "string") {
    const lines = rawItems.split("\n").map((s) => s.trim()).filter(Boolean);
    lines.forEach((line, i) => push(line, lines.length === 1 ? parallel[0] : parallel[i]));
    return out;
  }
  if (!Array.isArray(rawItems)) return out;
  rawItems.forEach((entry, i) => {
    if (typeof entry === "string") return push(entry, parallel[i]);
    if (!isRecord(entry)) return;
    const text = [entry.text, entry.title, entry.step, entry.task].find((v): v is string => typeof v === "string");
    if (text !== undefined && text.trim().length > 0) push(text.trim(), entry.tool ?? parallel[i]);
  });
  return out;
}

