/**
 * The builder's single "allowed commands" list for `shell-execute`.
 *
 * Three stored fields feed the framework allowlist (`ShellExecuteConfig`):
 * `terminalShellAllowedCommands` (replaces the defaults), `terminalShellAdditionalCommands`
 * (added on top) and legacy `terminalShellOptions.commandAccess` groups. The framework
 * grants `(allowed || defaults) ∪ additional ∪ groups`. The builder shows that union as
 * one list ({@link effectiveShellCommands}) and writes edits back as at most one of the
 * two command fields, never `commandAccess` ({@link shellCommandsPatch}).
 *
 * The default list, opt-in list and group map come from `GET /api/tools/shell-commands`
 * (framework `DEFAULT_ALLOWED_COMMANDS` / `OPT_IN_COMMANDS`); nothing here copies them.
 */

/** `GET /api/tools/shell-commands`. */
export interface ShellCommandCatalog {
  /** Framework `DEFAULT_ALLOWED_COMMANDS`. */
  readonly defaults: readonly string[];
  /** Framework `OPT_IN_COMMANDS`: powerful commands a developer must grant. */
  readonly optIn: readonly string[];
  /** `commandAccess` group id → the commands it grants (folds legacy saves). */
  readonly groups: Readonly<Record<string, readonly string[]>>;
}

/** The stored config fields that together make the shell allowlist. */
export interface ShellCommandFields {
  readonly terminalShellAdditionalCommands: string;
  readonly terminalShellAllowedCommands: string;
  readonly commandAccess: readonly string[];
}

/** What {@link shellCommandsPatch} writes back: one command field set, `commandAccess` cleared. */
export interface ShellCommandsPatch {
  readonly terminalShellAdditionalCommands: string;
  readonly terminalShellAllowedCommands: string;
  readonly commandAccess: string[];
}

/** One-click additions for the opt-in groups. `github` is left out: the `git` toolset brings `gh`. */
export const SHELL_QUICK_ADD: readonly { readonly id: string; readonly label: string; readonly note: string }[] = [
  { id: "javascript", label: "JavaScript", note: "runs any JavaScript and package scripts" },
  { id: "python", label: "Python", note: "runs any Python" },
  { id: "web", label: "Web", note: "can download files and send data out" },
  { id: "archive", label: "Archives", note: "can extract files outside the workspace" },
  { id: "environment", label: "Environment", note: "env and xargs can run any command" },
];

const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/** Split a comma / newline / space separated command list (the server splits on comma and newline). */
export function splitCommands(raw: string | undefined): string[] {
  return (raw ?? "").split(/[\s,]+/).filter((s) => s !== "");
}

const unique = (xs: readonly string[]): string[] => [...new Set(xs)];

/** The commands the agent may run: `(allowed || defaults) ∪ additional ∪ groups`, defaults first. */
export function effectiveShellCommands(f: ShellCommandFields, catalog: ShellCommandCatalog): string[] {
  const allowed = splitCommands(f.terminalShellAllowedCommands);
  const fromGroups = f.commandAccess.flatMap((g) => (Object.hasOwn(catalog.groups, g) ? catalog.groups[g] : []));
  return unique([...(allowed.length > 0 ? allowed : catalog.defaults), ...splitCommands(f.terminalShellAdditionalCommands), ...fromGroups]);
}

/**
 * The stored fields for an edited list. Every default still present: the extras go to
 * `additionalCommands` and the defaults stay implicit. A default removed: the whole list
 * becomes `allowedCommands`. An empty list is not representable (empty fields mean the
 * defaults), so callers keep at least one command.
 */
export function shellCommandsPatch(list: readonly string[], catalog: ShellCommandCatalog): ShellCommandsPatch {
  const cmds = unique(list);
  const keepsDefaults = catalog.defaults.every((d) => cmds.includes(d));
  return keepsDefaults
    ? { terminalShellAdditionalCommands: cmds.filter((c) => !catalog.defaults.includes(c)).join(", "), terminalShellAllowedCommands: "", commandAccess: [] }
    : { terminalShellAdditionalCommands: "", terminalShellAllowedCommands: cmds.join(", "), commandAccess: [] };
}

/** Parse typed input into command names; names that are not plain executables are returned as `invalid`. */
export function parseCommandInput(raw: string): { valid: string[]; invalid: string[] } {
  const parts = splitCommands(raw);
  return { valid: unique(parts.filter((p) => COMMAND_NAME.test(p))), invalid: parts.filter((p) => !COMMAND_NAME.test(p)) };
}

/** The list with `add` appended (deduped, order kept). */
export function withCommands(list: readonly string[], add: readonly string[]): string[] {
  return unique([...list, ...add]);
}

/** The commands of a quick-add group that the list does not have yet. */
export function missingGroupCommands(list: readonly string[], group: string, catalog: ShellCommandCatalog): string[] {
  const cmds = Object.hasOwn(catalog.groups, group) ? catalog.groups[group] : [];
  return cmds.filter((c) => !list.includes(c));
}

/** Whether a command is one the framework marks opt-in (risk note in the UI). */
export function isOptInCommand(cmd: string, catalog: ShellCommandCatalog): boolean {
  return catalog.optIn.includes(cmd);
}
