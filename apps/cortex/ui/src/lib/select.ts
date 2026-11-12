/**
 * Rules for the kit `Select` (a styled, searchable replacement for the native
 * select): option filtering, keyboard navigation, type-ahead and where the
 * list sits. Pure; `components/kit/Select.svelte` wires them to the DOM.
 */
import { matchRank } from "./combobox.js";

/** One choice in a `Select`. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** A quieter second line (what the choice does). Searched too. */
  readonly description?: string;
  /** Section heading; options with the same group are shown together. */
  readonly group?: string;
  readonly disabled?: boolean;
}

/** Options at or above this count get a search box. */
export const SELECT_SEARCH_MIN = 9;

/** Whether a list of `count` options shows a search box (`override` forces it on or off). */
export function showSearch(count: number, override?: boolean): boolean {
  return override ?? count >= SELECT_SEARCH_MIN;
}

/** The options matching `query`, best match first while searching; the given order otherwise. */
export function filterSelectOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  if (query.trim() === "") return [...options];
  const ranked: { o: SelectOption; rank: number; at: number }[] = [];
  options.forEach((o, at) => {
    const rank = matchRank({ value: o.value, label: o.label, hint: o.description }, query);
    if (rank >= 0) ranked.push({ o, rank, at });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map((r) => r.o);
}

/** Sections in first-seen order for the listbox; ungrouped options have the heading `""`. */
export function groupSelectOptions(options: readonly SelectOption[]): { group: string; options: SelectOption[] }[] {
  const out: { group: string; options: SelectOption[] }[] = [];
  for (const o of options) {
    const g = o.group ?? "";
    const found = out.find((s) => s.group === g);
    if (found) found.options.push(o);
    else out.push({ group: g, options: [o] });
  }
  return out;
}

/** The options in the order the listbox shows them (grouped), which is the order keys move through. */
export function displayOrder(options: readonly SelectOption[]): SelectOption[] {
  return groupSelectOptions(options).flatMap((s) => s.options);
}

/**
 * The text on the closed control: the chosen option's label; the raw value when
 * it is set but is no option (a custom model id); else `placeholder`.
 */
export function selectedLabel(options: readonly SelectOption[], value: string, placeholder = ""): string {
  return options.find((o) => o.value === value)?.label ?? (value !== "" ? value : placeholder);
}

/** Index of the first enabled option at or after `from` in direction `delta` (wrapping), or `-1` when none is enabled. */
export function nextEnabled(options: readonly SelectOption[], from: number, delta: 1 | -1): number {
  const n = options.length;
  for (let i = 0; i < n; i++) {
    const at = (((from + delta * i) % n) + n) % n;
    if (!options[at]!.disabled) return at;
  }
  return -1;
}

/** Index after a Down or Up press from `current`; wraps and skips disabled options. */
export function stepActive(options: readonly SelectOption[], current: number, delta: 1 | -1): number {
  if (options.length === 0) return -1;
  if (current < 0) return nextEnabled(options, delta === 1 ? 0 : options.length - 1, delta);
  return nextEnabled(options, current + delta, delta);
}

/** Index for Home (`first`) or End (`last`), skipping disabled options. */
export function edgeActive(options: readonly SelectOption[], edge: "first" | "last"): number {
  return edge === "first" ? nextEnabled(options, 0, 1) : nextEnabled(options, options.length - 1, -1);
}

/** The index to highlight when the list opens: the chosen option, else the first enabled one. */
export function initialActive(options: readonly SelectOption[], value: string): number {
  const at = options.findIndex((o) => o.value === value && !o.disabled);
  return at >= 0 ? at : nextEnabled(options, 0, 1);
}

/** Type-ahead gap in milliseconds: a pause longer than this starts a new prefix. */
export const TYPEAHEAD_MS = 600;

/**
 * Type-ahead: the next buffer and the index it lands on. Typing the same
 * letter again cycles through options starting with it; more letters narrow
 * to a prefix. `idleMs` is the time since the last key.
 */
export function typeahead(
  options: readonly SelectOption[],
  current: number,
  buffer: string,
  key: string,
  idleMs: number,
): { buffer: string; index: number } {
  const next = (idleMs > TYPEAHEAD_MS ? "" : buffer) + key.toLowerCase();
  const startsWith = (o: SelectOption, p: string): boolean => !o.disabled && o.label.toLowerCase().startsWith(p);
  const repeated = next.length > 1 && [...next].every((c) => c === next[0]);
  const prefix = repeated ? next[0]! : next;
  const from = repeated || next.length === 1 ? current + 1 : current;
  const n = options.length;
  for (let i = 0; i < n; i++) {
    const at = (((from + i) % n) + n) % n;
    if (startsWith(options[at]!, prefix)) return { buffer: next, index: at };
  }
  return { buffer: next, index: current };
}

/** A viewport rectangle. */
export interface ListRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the listbox sits (`position: fixed`). */
export interface ListPlacement {
  readonly side: "down" | "up";
  readonly left: number;
  readonly width: number;
  /** Distance from the viewport top; set when `side` is `down`. */
  readonly top?: number;
  /** Distance from the viewport bottom; set when `side` is `up`. */
  readonly bottom?: number;
  readonly maxHeight: number;
}

/**
 * Place the listbox under the trigger, flipping above when it does not fit and
 * there is more room there. It is at least as wide as the trigger and never
 * leaves the viewport; `maxHeight` shrinks to the room on the chosen side.
 */
export function placeListbox(input: {
  trigger: ListRect;
  /** Natural height of the list. */
  contentHeight: number;
  viewport: { width: number; height: number };
  /** Upper bound on the list height (default 320). */
  maxHeight?: number;
  /** Floor for the list width (default: the trigger's width). */
  minWidth?: number;
  margin?: number;
  gap?: number;
}): ListPlacement {
  const { trigger: t, viewport: vp } = input;
  const margin = input.margin ?? 8;
  const gap = input.gap ?? 4;
  const cap = input.maxHeight ?? 320;
  const want = Math.min(input.contentHeight, cap);
  const below = vp.height - (t.top + t.height) - margin - gap;
  const above = t.top - margin - gap;
  const side = below >= want || below >= above ? "down" : "up";
  const room = Math.max(0, side === "down" ? below : above);
  const maxHeight = Math.min(cap, room);
  const width = Math.min(Math.max(t.width, input.minWidth ?? 0), vp.width - 2 * margin);
  const left = Math.min(Math.max(t.left, margin), vp.width - width - margin);
  return side === "down"
    ? { side, left, width, top: t.top + t.height + gap, maxHeight }
    : { side, left, width, bottom: vp.height - t.top + gap, maxHeight };
}
