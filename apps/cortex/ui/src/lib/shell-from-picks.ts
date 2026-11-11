/**
 * Whether the selected tool picks bring `shell-execute` by themselves, and how the
 * host-shell controls show it.
 *
 * A shell toolset pick (`git`; the list comes from `GET /api/tools/shell-presets`,
 * framework `BUILTIN_SHELL_PRESETS`) resolves to a `shell-execute` limited to its
 * programs, without the user's host-shell switch (`terminalTools`). So the shell has
 * three states: `off` (no toolset, switch off), `toolset` (toolset picked, switch off:
 * a shell limited to the toolset's programs) and `full` (switch on: the full host
 * shell). While a toolset is picked the checkbox never shows unchecked, but it stays
 * clickable: a click flips the user's own `terminalTools`, moving between `toolset`
 * and `full`. Unpicking the toolset shows the user's own value again.
 */
export type ShellPresets = Readonly<Record<string, readonly string[]>>;

/** Shell toolset picks in `tools`, in pick order. */
export function shellToolsetPicks(tools: readonly string[], presets: ShellPresets): string[] {
  return [...new Set(tools.filter((t) => Object.hasOwn(presets, t)))];
}

/** True when any pick in `tools` is a shell toolset, i.e. the agent gets `shell-execute` from the picks alone. */
export function picksImplyShell(tools: readonly string[], presets: ShellPresets): boolean {
  return shellToolsetPicks(tools, presets).length > 0;
}

/** Programs the picked toolsets allow, e.g. `git · gh`; `undefined` when no pick brings the shell. */
function toolsetPrograms(tools: readonly string[], presets: ShellPresets): string | undefined {
  const picks = shellToolsetPicks(tools, presets);
  if (picks.length === 0) return undefined;
  return [...new Set(picks.flatMap((p) => presets[p] ?? []))].join(" · ");
}

/**
 * Short reason the shell is on because of picks, e.g. `enabled by git toolset (git · gh only)`;
 * `undefined` when no pick brings the shell.
 */
export function shellPickReason(tools: readonly string[], presets: ShellPresets): string | undefined {
  const picks = shellToolsetPicks(tools, presets);
  const programs = toolsetPrograms(tools, presets);
  if (programs === undefined) return undefined;
  return `enabled by ${picks.join(" + ")} toolset${picks.length > 1 ? "s" : ""} (${programs} only)`;
}

/** `off`: no shell. `toolset`: shell limited to the picked toolsets' programs. `full`: the full host shell. */
export type ShellState = "off" | "toolset" | "full";

/** The shell state for the user's own `terminalTools` value plus the current picks. */
export function shellState(terminalTools: boolean | undefined, tools: readonly string[], presets: ShellPresets): ShellState {
  if (terminalTools === true) return "full";
  return picksImplyShell(tools, presets) ? "toolset" : "off";
}

/** How the host-shell checkbox renders: whether it shows checked, and the hint under it (if any). */
export interface ShellCheckboxView {
  readonly state: ShellState;
  readonly checked: boolean;
  readonly hint: string | undefined;
}

/** The checkbox view. Checked in `toolset` and `full`; the hint says what a click does while a toolset is picked. */
export function shellCheckboxView(terminalTools: boolean | undefined, tools: readonly string[], presets: ShellPresets): ShellCheckboxView {
  const state = shellState(terminalTools, tools, presets);
  const programs = toolsetPrograms(tools, presets);
  const hint =
    programs === undefined
      ? undefined
      : state === "toolset"
        ? `Limited to ${programs} by the toolset pick. Click for the full shell.`
        : `Full shell on. Click to limit it to ${programs}.`;
  return { state, checked: state !== "off", hint };
}

/**
 * The user's `terminalTools` after a checkbox click: always the flip of their own value.
 * `off` → `full`, `toolset` → `full`, `full` → `toolset` (toolset picked) or `off`.
 */
export function shellCheckboxClick(terminalTools: boolean | undefined): boolean {
  return terminalTools !== true;
}

/** Label for the chat `/terminal` row that turns the full shell off: it lands in `toolset` when one is picked. */
export function shellOffLabel(tools: readonly string[], presets: ShellPresets): string {
  const programs = toolsetPrograms(tools, presets);
  return programs === undefined ? "Shell off" : `Shell: ${programs} only`;
}

/** Detail for that row. */
export function shellOffDetail(tools: readonly string[], presets: ShellPresets): string {
  const reason = shellPickReason(tools, presets);
  return reason === undefined ? "No shell-execute tool" : `No full shell; shell-execute ${reason}`;
}
