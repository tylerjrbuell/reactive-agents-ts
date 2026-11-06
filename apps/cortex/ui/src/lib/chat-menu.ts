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

/** The composer + menu state the chip and close handlers move together. */
export type MenuUi = { readonly chip: ChipMenu; readonly message: string; readonly dismissed: boolean };

/** A quick-bar chip was clicked: open (or toggle shut) its picker; the menu is dismissed only when it closed. */
export function pickChip(ui: MenuUi, cmd: string, menuOpen: boolean): MenuUi {
  const r = chipClicked(ui.chip, ui.message, cmd, menuOpen);
  return { chip: r.menu, message: r.message, dismissed: !r.open };
}

/**
 * Close the menu. `dismiss` (Escape, click outside, Enter on a multi row) keeps it shut
 * until the user types again; `picked` (a single choice ran) leaves that flag alone.
 */
export function closeMenu(ui: MenuUi, reason: "dismiss" | "picked"): MenuUi {
  const r = menuClosed(ui.chip, ui.message, reason);
  return { chip: r.menu, message: r.message, dismissed: reason === "dismiss" ? true : ui.dismissed };
}

/**
 * Serialise multi-row toggles so fast clicks are not dropped. Each patch is computed
 * when its turn comes (from the config the previous toggle left behind), and a failed
 * toggle reports through `onError` without breaking the chain.
 */
export function createToggleQueue(
  apply: (patch: Record<string, unknown>) => Promise<unknown>,
  onError: (what: string, e: unknown) => void,
): (what: string, patch: () => Record<string, unknown>) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  return (what, patch) => {
    chain = chain.then(() => apply(patch())).then(
      () => undefined,
      (e: unknown) => onError(what, e),
    );
    return chain;
  };
}

/** Whether running this row keeps the menu open: multi rows clicked or Tabbed; Enter always closes. */
export function keepsMenuOpen(item: Pick<MenuItem, "multi">, via: "click" | "tab" | "enter"): boolean {
  return item.multi === true && via !== "enter";
}
