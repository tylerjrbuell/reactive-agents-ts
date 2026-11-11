/**
 * Command palette (Ctrl/Cmd+K) state and the pure rules behind it: matching
 * and ranking a query, grouping the result into sections, the matched-text
 * highlight and wrap-around selection. `CommandPalette.svelte` only renders
 * what these return; the default commands live in `lib/palette-commands.ts`.
 */
import { writable, derived } from "svelte/store";
import type { IconName } from "../icons.js";

/** Palette sections, in display order. */
export const COMMAND_GROUPS = ["Navigate", "Lab", "Runs", "Actions"] as const;

/** One palette section. */
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** Section the command lists under; `Actions` when unset. */
  readonly group?: CommandGroup;
  /** A kit icon (`lib/icons.ts`), never a ligature-font name. */
  readonly icon?: IconName;
  /** Global key that does the same thing outside the palette (shown as a hint). */
  readonly shortcut?: string;
  readonly action: () => void | Promise<void>;
  readonly keywords?: string[];
}

/** A command in a section, with its position in the flat (keyboard) order. */
export interface CommandSectionItem {
  readonly command: Command;
  readonly index: number;
}

/** One rendered section of the palette. */
export interface CommandSection {
  readonly group: CommandGroup;
  readonly items: readonly CommandSectionItem[];
}

/** What the palette shows for a query: the sections and the same commands in keyboard order. */
export interface PaletteView {
  readonly sections: readonly CommandSection[];
  readonly flat: readonly Command[];
}

/** A run of label text, marked when it matches the query. */
export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

/** Most commands a query lists (the empty query lists every command). */
export const MAX_MATCHES = 30;

const groupOf = (c: Command): CommandGroup => c.group ?? "Actions";

const tokensOf = (query: string): string[] => query.toLowerCase().trim().split(/\s+/).filter(Boolean);

const wordStart = (text: string, token: string): boolean =>
  text.split(/[^a-z0-9]+/).some((w) => w.startsWith(token));

/** Best score one query token earns against a command; 0 when it matches nothing. */
function tokenScore(c: Command, token: string): number {
  const label = c.label.toLowerCase();
  if (label.startsWith(token)) return 100;
  if (wordStart(label, token)) return 80;
  if (label.includes(token)) return 60;
  const keywords = (c.keywords ?? []).map((k) => k.toLowerCase());
  if (keywords.some((k) => k.startsWith(token))) return 40;
  if (keywords.some((k) => k.includes(token))) return 30;
  if (c.description?.toLowerCase().includes(token)) return 10;
  return 0;
}

/**
 * How well `command` matches `query`: every whitespace-separated word must
 * match the label, a keyword or the description; the score sums each word's
 * best match (label start > word start > inside the label > keyword >
 * description). 0 means no match. An empty query matches everything with 1.
 */
export function scoreCommand(command: Command, query: string): number {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return 1;
  let total = 0;
  for (const t of tokens) {
    const s = tokenScore(command, t);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/**
 * The commands that match `query`, best first (ties keep registration order),
 * at most `limit`. An empty query returns every command in registration order.
 */
export function filterCommands(commands: readonly Command[], query: string, limit = MAX_MATCHES): Command[] {
  if (tokensOf(query).length === 0) return [...commands];
  return commands
    .map((command, order) => ({ command, order, score: scoreCommand(command, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((r) => r.command);
}

/**
 * Group a list into sections. With `ranked` (a query is typed) sections
 * follow their best match, so the first row is the best match overall;
 * otherwise sections follow `COMMAND_GROUPS`. Items keep their order inside a
 * section, and `index` numbers them in display order.
 */
export function groupCommands(list: readonly Command[], ranked: boolean): CommandSection[] {
  const byGroup = new Map<CommandGroup, Command[]>();
  for (const c of list) {
    const g = groupOf(c);
    const bucket = byGroup.get(g);
    if (bucket) bucket.push(c);
    else byGroup.set(g, [c]);
  }
  const order = ranked ? [...byGroup.keys()] : COMMAND_GROUPS.filter((g) => byGroup.has(g));
  let index = 0;
  return order.map((group) => ({
    group,
    items: (byGroup.get(group) ?? []).map((command) => ({ command, index: index++ })),
  }));
}

/** The palette for a query: matching commands grouped into sections, plus the flat keyboard order. */
export function paletteView(commands: readonly Command[], query: string): PaletteView {
  const ranked = tokensOf(query).length > 0;
  const sections = groupCommands(filterCommands(commands, query), ranked);
  return { sections, flat: sections.flatMap((s) => s.items.map((i) => i.command)) };
}

/**
 * Split `text` into plain and matched runs: the first occurrence of each
 * query word is marked (case-insensitive), overlapping marks merge.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const t of tokensOf(query)) {
    const at = lower.indexOf(t);
    if (at >= 0) ranges.push([at, at + t.length]);
  }
  if (ranges.length === 0) return text ? [{ text, match: false }] : [];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: HighlightSegment[] = [];
  let pos = 0;
  for (const [from, to] of merged) {
    if (from > pos) out.push({ text: text.slice(pos, from), match: false });
    out.push({ text: text.slice(from, to), match: true });
    pos = to;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), match: false });
  return out;
}

/** Move a selection by `delta` over `count` rows, wrapping at both ends; 0 when the list is empty. */
export function wrapIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

const registered = writable<Command[]>([]);

export const commandPaletteQuery = writable("");
export const commandPaletteOpen = writable(false);

/** Sections and keyboard order for the current query. */
export const commandPaletteView = derived([registered, commandPaletteQuery], ([$commands, $q]) =>
  paletteView($commands, $q),
);

/** Matching commands in keyboard (display) order. */
export const commandPaletteFiltered = derived(commandPaletteView, ($v) => $v.flat);

export const commandPalette = {
  open: () => {
    commandPaletteOpen.set(true);
    commandPaletteQuery.set("");
  },
  close: () => {
    commandPaletteOpen.set(false);
    commandPaletteQuery.set("");
  },
  toggle: () => {
    commandPaletteOpen.update((v) => !v);
    commandPaletteQuery.set("");
  },
  /** Add commands (an id already registered is replaced); returns the unregister function. */
  register: (commands: Command[]) => {
    registered.update((existing) => {
      const ids = new Set(commands.map((c) => c.id));
      return [...existing.filter((c) => !ids.has(c.id)), ...commands];
    });
    return () => {
      registered.update((existing) => existing.filter((c) => !commands.some((nc) => nc.id === c.id)));
    };
  },
};
