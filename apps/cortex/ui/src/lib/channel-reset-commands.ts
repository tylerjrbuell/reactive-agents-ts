/**
 * Lab · Channels: a route's reset commands (`resetCommands`). When a route OWNER sends one of them as the
 * whole message (for example `/new`), the conversation's saved history is cleared and the next message
 * starts fresh; the agent never sees the command. Pure (no fetch, no DOM). The server runs the framework's
 * `validateRoutes`, which is the authority; these rules give the answer before the request.
 *
 * Three states, kept apart so "default" is never written as an explicit list:
 *  - blank list, not off: the route has no `resetCommands` (the framework default applies)
 *  - a list: those commands only
 *  - off: `[]` (no command resets this route)
 */

/** The framework default (shown as a placeholder, never written unless the person types it). */
export const RESET_DEFAULTS: readonly string[] = ["/new", "/reset"];
/** The framework's limits (`validateRoutes`). */
export const RESET_MAX_COMMANDS = 5;
const RESET_COMMAND = /^\/[A-Za-z0-9_-]{1,31}$/;

/** The part of a route draft this module edits. */
export interface ResetDraft {
  /** One command per line; blank = the framework default. */
  resetCommands: string;
  /** True = no command resets this route (`resetCommands: []`). */
  resetOff: boolean;
}

const lines = (s: string): string[] => s.split(/[\n,]/).map((l) => l.trim()).filter((l) => l !== "");

/** The editor fields for a saved route's `resetCommands` (`undefined` = default). */
export function resetDraftFromWire(resetCommands: readonly string[] | undefined): ResetDraft {
  if (resetCommands === undefined) return { resetCommands: "", resetOff: false };
  return resetCommands.length === 0 ? { resetCommands: "", resetOff: true } : { resetCommands: resetCommands.join("\n"), resetOff: false };
}

/** The wire value for the editor fields, or `undefined` when the route should carry none (framework default). */
export function resetWireFromDraft(d: ResetDraft): string[] | undefined {
  if (d.resetOff) return [];
  const list = lines(d.resetCommands);
  return list.length === 0 ? undefined : list;
}

/** Problems that would make the server refuse the commands, in plain words. */
export function resetProblems(d: ResetDraft): string[] {
  if (d.resetOff) return [];
  const list = lines(d.resetCommands);
  const out: string[] = [];
  if (list.length > RESET_MAX_COMMANDS) out.push(`Use at most ${RESET_MAX_COMMANDS} reset commands.`);
  for (const c of list) {
    if (!RESET_COMMAND.test(c)) out.push(`"${c}" is not a command. Start with a slash, then 1 to 31 letters, digits, _ or -, like /new.`);
  }
  return out;
}

/** One line for the list or hint: what resets this route's conversation. */
export function resetSummary(resetCommands: readonly string[] | undefined): string {
  const list = resetCommands ?? RESET_DEFAULTS;
  return list.length === 0 ? "Owners cannot reset the conversation from chat." : `Owners reset with ${list.join(" or ")}.`;
}
