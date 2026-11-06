/** Window width below which the trace drawer overlays the conversation. */
export const OVERLAY_BELOW = 1100;
/** The conversation column never gets narrower than this when docked. */
export const MIN_CONVERSATION = 420;
export const MIN_DRAWER = 320;

export interface TraceLayout {
  /** `docked` shares the row with the conversation; `overlay` floats over it. */
  readonly mode: "docked" | "overlay";
  /** Drawer width in px after clamping. */
  readonly width: number;
}

/**
 * Decide how the trace drawer sits next to the conversation.
 * @param windowWidth viewport width
 * @param rowWidth width of the row that holds conversation + drawer
 * @param desired user-chosen drawer width
 */
export function traceLayout(windowWidth: number, rowWidth: number, desired: number): TraceLayout {
  const room = rowWidth - MIN_CONVERSATION;
  if (windowWidth < OVERLAY_BELOW || room < MIN_DRAWER) {
    return { mode: "overlay", width: Math.max(MIN_DRAWER > rowWidth ? rowWidth : MIN_DRAWER, Math.min(desired, Math.round(rowWidth * 0.92))) };
  }
  return { mode: "docked", width: Math.min(desired, room) };
}

/** `localStorage` key that remembers whether the trace drawer is open. */
export const TRACE_OPEN_KEY = "cortex.chat.traceOpen";

type FlagStorage = Pick<Storage, "getItem" | "setItem">;
const browserStorage = (): FlagStorage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

/** Read a remembered on/off flag; false when storage is missing or throws. */
export function readStoredFlag(key: string, storage: FlagStorage | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Remember an on/off flag; a storage failure is ignored (the toggle still works for this visit). */
export function writeStoredFlag(key: string, on: boolean, storage: FlagStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(key, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
