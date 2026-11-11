/**
 * Scoped shell preset: `shell-execute` limited to a few named programs.
 *
 * Replaces the gh-cli and git-cli wrappers (owner decision 2026-11-10; the
 * gws-cli wrapper and `workspace` preset were removed outright, see
 * {@link REMOVED_BUILTIN_NAMES}). Those tools ran `<program> <command>`, so a model that wrote
 * the full command line ran `gh gh repo view ...`; a spike over 3,090 traces
 * found most of their failures were that confusion. The scoped shell takes
 * the full command line, so the class cannot happen.
 *
 * There is one execution path: the preset is only a {@link ShellExecuteConfig}
 * (allow-list = the programs) plus a description that names them. The guard,
 * sandbox, host environment, timeout and output cap are shell-execute's own.
 */
import type { Effect } from "effect";
import type { ToolDefinition } from "../types.js";
import type { ToolExecutionError } from "../errors.js";
import { sandboxDockerEnabled } from "../flags.js";
import { shellExecuteHandler, type ShellExecuteConfig } from "./shell-execution.js";
import {
  describeShellLocation,
  shellExecuteToolFor,
  type ShellToolSurface,
} from "./shell-execute-definition.js";

/**
 * Programs each shell toolset alias grants (`.withTools({ builtins: ["git"] })`).
 * The alias itself expands to `shell-execute` in `BUILTIN_TOOLSET_ALIASES`;
 * this table says which programs that shell may run.
 */
export const BUILTIN_SHELL_PRESETS = {
  git: ["git", "gh"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/**
 * Removed wrapper tool names and the program each one ran. A request for one
 * of these names resolves to `shell-execute` scoped to that program, with a
 * deprecation notice (see `resolveBuiltinSelection`).
 */
export const DEPRECATED_CLI_TOOLS = {
  "gh-cli": "gh",
  "git-cli": "git",
} as const satisfies Readonly<Record<string, string>>;

/**
 * Removed built-in names that now select NO tool, and the program they used
 * to run. The `workspace` preset and `gws-cli` gave a shell scoped to `gws`
 * (Google Workspace CLI); owner decision 2026-11-10: gws is an ordinary shell
 * CLI and needs no dedicated toolset. Requesting one of these names logs a
 * deprecation telling the caller to enable the terminal and allow the
 * program. It never widens to a shell on its own.
 */
export const REMOVED_BUILTIN_NAMES = {
  workspace: "gws",
  "gws-cli": "gws",
} as const satisfies Readonly<Record<string, string>>;

/** Example command lines shown to the model, per known program. */
const EXAMPLES: Readonly<Record<string, string>> = {
  gh: "gh repo view owner/name",
  git: "git log --oneline -5",
};

const exampleFor = (program: string): string => EXAMPLES[program] ?? `${program} --help`;

/**
 * Shell config whose allow-list is exactly `programs`. Sandbox fields of
 * `base` (cwd, timeout, output cap, sandbox mode, audit) are kept; its command
 * lists are replaced, so nothing outside `programs` is allowed.
 *
 * The programs go in `additionalCommands` (with an empty base list) because
 * shell-execute resolves the host PATH directory of additional commands only:
 * a CLI installed in a user bin dir (gws under nvm, gh under Homebrew) runs.
 */
export function scopedShellConfig(
  programs: readonly string[],
  base?: ShellExecuteConfig,
): ShellExecuteConfig {
  const list = [...new Set(programs)];
  return {
    ...base,
    allowedCommands: [],
    additionalCommands: list,
    commandAccess: undefined,
    // git needs the user's identity and credential helpers (the old git-cli
    // ran with the real environment); a copy keeps the real file unwritten.
    inheritGitConfig: base?.inheritGitConfig ?? list.includes("git"),
  };
}

/**
 * The `shell-execute` definition for a scoped shell. Timeout and category
 * follow shell-execute; approval and risk are the removed wrappers'
 * (`requiresApproval: false`, `riskLevel: "medium"`). The description names
 * the allowed programs and asks for the full command line.
 */
export function scopedShellToolFor(
  programs: readonly string[],
  base?: ShellExecuteConfig,
  surface?: ShellToolSurface,
): ToolDefinition {
  const config = scopedShellConfig(programs, base);
  const list = config.additionalCommands ?? [];
  const names = list.join(", ");
  const examples = list.map((p) => `\`${exampleFor(p)}\``).join(", ");
  const docker = (config.sandbox ?? (sandboxDockerEnabled() ? "docker" : "host")) === "docker";
  const generic = shellExecuteToolFor(config, surface);

  const description = [
    `Run ${names} commands. Write the full command, starting with the program name, e.g. ${examples}.`,
    `Only ${names} may run: every piped or chained segment must start with one of them.`,
    describeShellLocation(config, surface, docker),
    "Paths must stay inside the working directory. Each call is a fresh shell (cd does not persist).",
    "No shell expansion ($VAR, ${...}, $(...), backticks), process substitution or trailing &.",
    "Returns { executed, output, exitCode, stderr, truncated }.",
  ].join(" ");

  return {
    ...generic,
    // The caller chose these programs by name, so the posture is the old
    // wrappers' (no approval, medium risk), not the open terminal's.
    // ShellExecuteConfig has no approval field; plain shell-execute is unchanged.
    requiresApproval: false,
    riskLevel: "medium",
    description,
    parameters: [
      {
        name: "command",
        type: "string",
        description: `The full command line, starting with ${list.length === 1 ? names : `one of ${names}`}, e.g. ${examples}.`,
        required: true,
      },
    ],
  };
}

/** A scoped shell ready to register: definition plus shell-execute handler. */
export interface ScopedShellTool {
  readonly definition: ToolDefinition;
  readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}

/**
 * `shell-execute` limited to `programs`, e.g. `scopedShellTool(["git", "gh"])`.
 * Register it in place of shell-execute; do not register both (same name).
 * When the full terminal is also on, add the programs to the terminal's
 * `additionalCommands` instead.
 */
export function scopedShellTool(
  programs: readonly string[],
  base?: ShellExecuteConfig,
  surface?: ShellToolSurface,
): ScopedShellTool {
  return {
    definition: scopedShellToolFor(programs, base, surface),
    handler: shellExecuteHandler(scopedShellConfig(programs, base)),
  };
}
