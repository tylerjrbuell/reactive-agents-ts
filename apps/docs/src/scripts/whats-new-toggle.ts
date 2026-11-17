/**
 * "Highlight what's new" preference. Default ON. When OFF, `<html>` carries
 * `data-ra-whats-new="off"` and CSS hides New/Updated markers (never stability
 * tags). The same attribute is set by an inline head script (astro.config.mjs)
 * before first paint so there is no flash or layout shift.
 */
export const WHATS_NEW_STORAGE_KEY = "ra-whats-new";
export const WHATS_NEW_ATTR = "data-ra-whats-new";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Read the saved preference; storage that throws (private mode, blocked) means ON. */
export function readWhatsNewPref(storage: StorageLike | undefined): boolean {
  try {
    return storage?.getItem(WHATS_NEW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeWhatsNewPref(storage: StorageLike | undefined, on: boolean): void {
  try {
    storage?.setItem(WHATS_NEW_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Preference just will not persist.
  }
}

type RootLike = { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

export function applyWhatsNewPref(root: RootLike, on: boolean): void {
  if (on) root.removeAttribute(WHATS_NEW_ATTR);
  else root.setAttribute(WHATS_NEW_ATTR, "off");
}

type SwitchLike = { setAttribute(n: string, v: string): void };

/** Sync the switch button's state to the preference. */
export function syncSwitch(button: SwitchLike, on: boolean): void {
  button.setAttribute("aria-checked", on ? "true" : "false");
}
