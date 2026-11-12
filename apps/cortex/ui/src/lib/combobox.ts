/**
 * Filter and order rules for the kit `Combobox` (a searchable pick list that
 * replaces a native `<select>` once a list can run to hundreds of rows), and the
 * agent picker's items for Lab Memory and Lab Skills. Pure.
 *
 * A native select renders every option and has no search; with 500+ agents
 * that is hundreds of DOM nodes per open and no way to find one. The combobox
 * ranks matches, groups them, and renders at most `cap` rows, saying how many
 * more there are.
 */
import type { MemoryAgent } from "./memory-studio.js";
import { shortId } from "./memory-studio.js";

/** One pickable row. */
export interface ComboItem {
  readonly value: string;
  /** What the row is called (never a raw id when a name exists). */
  readonly label: string;
  /** A quieter second line: the short id, run count. Searched too. */
  readonly hint?: string;
  /** Section heading. Rows keep their given order within a section. */
  readonly group?: string;
}

/** A heading and its visible rows. */
export interface ComboSection {
  readonly group: string;
  readonly items: readonly ComboItem[];
}

/** The list a combobox shows for a query. */
export interface ComboView {
  /** Sections in first-seen order; a section with no visible rows is dropped. */
  readonly sections: readonly ComboSection[];
  /** The visible rows in display order (the keyboard moves through this). */
  readonly flat: readonly ComboItem[];
  /** Rows that matched, before the cap. */
  readonly total: number;
  /** Matched rows left out by the cap. */
  readonly hidden: number;
}

/** Rows shown at most. 40 keeps a list well under a screenful of DOM. */
export const COMBO_CAP = 40;

/** 0 = label starts with the query; 1 = a word of the label does; 2 = label contains it; 3 = hint or value does; -1 = no match. */
export function matchRank(item: ComboItem, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/[\s\-_/.]+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if (item.hint?.toLowerCase().includes(q) || item.value.toLowerCase().includes(q)) return 3;
  return -1;
}

/**
 * The rows to show for `query`. With no query the given order is kept (callers
 * sort recent first). With one, rows are ranked by {@link matchRank} (ties keep
 * the given order), then grouped and capped at `cap`.
 */
export function filterComboItems(items: readonly ComboItem[], query: string, cap: number = COMBO_CAP): ComboView {
  const searching = query.trim() !== "";
  const matched: { item: ComboItem; rank: number; at: number }[] = [];
  items.forEach((item, at) => {
    const rank = matchRank(item, query);
    if (rank >= 0) matched.push({ item, rank, at });
  });
  if (searching) matched.sort((a, b) => a.rank - b.rank || a.at - b.at);
  const order: string[] = [];
  const byGroup = new Map<string, ComboItem[]>();
  for (const { item } of matched) {
    const g = item.group ?? "";
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      order.push(g);
    }
    byGroup.get(g)!.push(item);
  }
  // Fill the cap section by section, in order: a section after a full one is left out (counted in `hidden`).
  const sections: ComboSection[] = [];
  let left = Math.max(0, cap);
  const perGroup = new Map<string, readonly ComboItem[]>();
  for (const g of order) {
    const rows = byGroup.get(g)!;
    const take = rows.slice(0, left);
    left -= take.length;
    perGroup.set(g, take);
  }
  for (const g of order) {
    const rows = perGroup.get(g)!;
    if (rows.length > 0) sections.push({ group: g, items: rows });
  }
  const flat = sections.flatMap((s) => s.items);
  return { sections, flat, total: matched.length, hidden: matched.length - flat.length };
}

/** Index after a keyboard step, wrapping at both ends. */
export function stepIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Combobox items for agents with a memory database: recent first (last run,
 * newest), then by name; agents with a name (saved agent, chat, a named run)
 * under "Named", the rest under "Unnamed" with their short id, never a bare ULID
 * as the label. The full id stays searchable through `value`.
 */
export function agentComboItems(agents: readonly MemoryAgent[]): ComboItem[] {
  const recent = [...agents].sort((a, b) => (b.lastRunAt ?? -1) - (a.lastRunAt ?? -1) || a.label.localeCompare(b.label));
  const item = (a: MemoryAgent, named: boolean): ComboItem => ({
    value: a.agentId,
    label: named ? a.label : "Unnamed agent",
    hint: `${shortId(a.agentId)}${a.runCount > 0 ? ` · ${plural(a.runCount, "run", "runs")}` : ""}`,
    group: named ? "Named" : "Unnamed",
  });
  const isNamed = (a: MemoryAgent): boolean => a.label !== a.agentId;
  return [...recent.filter(isNamed).map((a) => item(a, true)), ...recent.filter((a) => !isNamed(a)).map((a) => item(a, false))];
}

/** The text shown in the closed combobox for the chosen value. */
export function comboSelectedLabel(items: readonly ComboItem[], value: string): string {
  const found = items.find((i) => i.value === value);
  if (found) return found.hint && found.label === "Unnamed agent" ? `${found.label} (${found.hint.split(" · ")[0]})` : found.label;
  return value === "" ? "" : shortId(value);
}
