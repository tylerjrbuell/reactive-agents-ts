/** One row in the chat slash menu: a command, or a second-level choice for /model, /skills, … */
export type MenuItem = {
  key: string;
  icon: string;
  label: string;
  hint?: string;
  detail?: string;
  active?: boolean;
  /** Small icon after the label, e.g. the brain on thinking models (survives the "current" check mark). */
  badge?: string;
  /**
   * Part of a multi-value picker (tools, skills, docs): clicking toggles it in place
   * and the menu stays open so several can be changed in one visit.
   */
  multi?: boolean;
  run: () => void | Promise<void>;
  complete?: () => void;
};

/**
 * What the composer held before a quick-bar chip replaced it with a picker command.
 * `stash` is the user's draft (restored when the picker closes); `chipCmd` is the
 * command the chip inserted (so we can tell the user has not typed over it).
 */
export type ChipMenu = { readonly stash: string | null; readonly chipCmd: string | null };

export const NO_CHIP_MENU: ChipMenu = { stash: null, chipCmd: null };

/**
 * A chip was clicked. Same chip while its picker is open closes it (restoring the
 * draft); another chip switches straight to its picker, keeping the original draft.
 */
export function chipClicked(s: ChipMenu, message: string, cmd: string, menuOpen: boolean): { menu: ChipMenu; message: string; open: boolean } {
  const chipShowing = s.chipCmd !== null && message === s.chipCmd;
  if (chipShowing && cmd === s.chipCmd && menuOpen) {
    return { menu: NO_CHIP_MENU, message: s.stash ?? "", open: false };
  }
  // Keep the first draft across chip-to-chip switches; a typed-over command is the new draft.
  const stash = chipShowing ? s.stash : message.trim() === "" ? null : message;
  return { menu: { stash, chipCmd: cmd }, message: cmd, open: true };
}

/**
 * The menu closes (Escape, click outside, Enter on a multi row, or a single pick).
 * If the composer still holds exactly what the chip inserted, the draft comes back;
 * anything the user typed stays (a single pick clears it, as before).
 */
export function menuClosed(s: ChipMenu, message: string, reason: "dismiss" | "picked"): { menu: ChipMenu; message: string } {
  if (s.chipCmd !== null && (message === s.chipCmd || reason === "picked")) return { menu: NO_CHIP_MENU, message: s.stash ?? "" };
  return { menu: NO_CHIP_MENU, message: reason === "picked" ? "" : message };
}

/** Forget the chip once the composer no longer holds its command (the user typed something else or sent). */
export function syncChipMenu(s: ChipMenu, message: string): ChipMenu {
  return s.chipCmd !== null && !message.startsWith(s.chipCmd.trimEnd()) ? NO_CHIP_MENU : s;
}

/** Whether running this row keeps the menu open: multi rows clicked or Tabbed; Enter always closes. */
export function keepsMenuOpen(item: Pick<MenuItem, "multi">, via: "click" | "tab" | "enter"): boolean {
  return item.multi === true && via !== "enter";
}
