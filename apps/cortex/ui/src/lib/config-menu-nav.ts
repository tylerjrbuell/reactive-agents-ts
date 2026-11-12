/**
 * Navigation of the chat Config popover (pure; `ChatQuickBar.svelte` renders it).
 *
 * Three levels: the main menu (the groups), one group's rows, and the picker a row
 * opens (the slash menu above the composer, owned by ChatPanel). The popover hides
 * while a picker shows; when the picker closes the user lands back on that group, so
 * a place is never lost. Back and Escape both go up one level; only Escape or Back
 * from the main menu, or a click outside, closes everything.
 */
import type { ConfigGroup } from "./chat-composer-bar.js";

/** Where the user is in the Config popover. */
export interface ConfigNav {
  /** The popover is on screen. */
  readonly open: boolean;
  readonly level: "menu" | "group" | "item";
  /** Title of the group being viewed or picked from. */
  readonly group: string | null;
  /** Slash command of the row whose picker is showing (level `item`). */
  readonly item: string | null;
}

/** The popover closed and reset to its main menu. */
export const CLOSED_NAV: ConfigNav = { open: false, level: "menu", group: null, item: null };

/** Events that move through the popover. */
export type ConfigNavEvent =
  | { readonly type: "toggle" }
  | { readonly type: "enter-group"; readonly group: string }
  | { readonly type: "pick"; readonly cmd: string }
  | { readonly type: "back" }
  | { readonly type: "escape" }
  | { readonly type: "outside" }
  | { readonly type: "picker-closed" };

const MENU: ConfigNav = { open: true, level: "menu", group: null, item: null };

/** Next navigation state for an event. */
export function configNavReduce(s: ConfigNav, e: ConfigNavEvent): ConfigNav {
  switch (e.type) {
    case "toggle":
      return s.open ? CLOSED_NAV : MENU;
    case "enter-group":
      return s.open ? { open: true, level: "group", group: e.group, item: null } : s;
    case "pick":
      return s.open && s.group !== null ? { open: false, level: "item", group: s.group, item: e.cmd } : s;
    case "back":
    case "escape":
      if (s.level === "item") return { open: true, level: "group", group: s.group, item: null };
      if (s.open && s.level === "group") return MENU;
      return CLOSED_NAV;
    case "outside":
      return CLOSED_NAV;
    case "picker-closed":
      return s.level === "item" ? { open: true, level: "group", group: s.group, item: null } : s;
  }
}

/** The group a nav points at, if it still exists (a setting may remove a group). */
export function groupOf(groups: readonly ConfigGroup[], nav: ConfigNav): ConfigGroup | undefined {
  return nav.group === null ? undefined : groups.find((g) => g.title === nav.group);
}

/** One line under a group's name on the main menu: what differs from the default, else the first values. */
export function groupSummary(g: ConfigGroup): string {
  const changed = g.rows.filter((r) => r.on);
  if (changed.length > 0) return changed.map((r) => `${r.label} ${r.value}`).join(", ");
  return g.rows.slice(0, 2).map((r) => r.value).join(", ");
}
