/**
 * Shell command catalog — the single source of which programs `shell-execute`
 * may run, and how capability groups map to opt-in commands.
 *
 * Exported from the package index so apps that build a shell-permission UI
 * (allow-list pickers, capability toggles) read the framework's catalog
 * instead of copying it. Moved verbatim out of `shell-execution.ts`, which
 * re-exports every symbol for existing importers.
 */

/**
 * Default allow-listed command prefixes.
 *
 * Only the first word of the command (the executable name) is checked.
 * `rm`, `chmod`, `chown` are excluded intentionally — file deletion and
 * permission changes are too destructive for an agent sandbox.
 *
 * Builders: this is the base set `shell-execute` runs with no opt-in.
 * `ShellExecuteConfig.allowedCommands` replaces it; `additionalCommands`
 * and `commandAccess` add to it.
 */
export const DEFAULT_ALLOWED_COMMANDS: ReadonlyArray<string> = [
  // Version control
  "git",
  // File listing / reading (read-only)
  "ls",
  "cat",
  "grep",
  "find",
  // Output
  "echo",
  "printf",
  // File manipulation (sandbox-scoped)
  "mkdir",
  "cp",
  "mv",
  "touch",
  // Text processing (no shell-escape vectors)
  "wc",
  "head",
  "tail",
  "sort",
  "uniq",
  "cut",
  "tr",
  "tee",
  "diff",
  "sed",
  "awk",
  // JSON processing
  "jq",
  // Informational
  "pwd",
  "date",
  "which",
  "basename",
  "dirname",
  // Shell builtins / utilities
  "test",
  "true",
  "false",
  "seq",
  // Compression (sandbox-scoped)
  "gzip",
  "gunzip",
  "zip",
  "unzip",
];

/**
 * Commands that require explicit opt-in via `additionalCommands`.
 *
 * These are powerful tools with shell-escape vectors (arbitrary code
 * execution, file write, data exfiltration). Developers must consciously
 * grant access when building agents — taking ownership and liability
 * for any command granted.
 *
 * Builders: show these as "dangerous, off by default" in a permission UI.
 * The capability groups in {@link COMMAND_CAPABILITY_MAP} grant subsets.
 *
 * @example
 * ```ts
 * shellExecuteHandler({ additionalCommands: ["node", "curl", "gh"] })
 * ```
 */
export const OPT_IN_COMMANDS: ReadonlyArray<string> = [
  "node",      // Arbitrary JS execution
  "bun",       // Arbitrary JS execution
  "npm",       // Runs arbitrary scripts via package.json
  "npx",       // Downloads and runs arbitrary packages
  "python",    // Arbitrary Python execution
  "python3",   // Arbitrary Python execution
  "curl",      // Can write files (-o), exfiltrate data (-d @)
  "env",       // Runs arbitrary commands: env sh -c "..."
  "xargs",     // Pipes stdin to arbitrary executables
  "tar",       // Can extract outside sandbox with -C
];

/**
 * Higher-level command-access presets for shell-execute.
 *
 * This is an additive abstraction over raw `additionalCommands` and is meant
 * to make common CLI enablement simpler and safer to reason about.
 */
export interface ShellCommandAccessConfig {
  /**
   * Capability groups that map to one or more concrete commands.
   *
   * - `github`: gh
   * - `web`: curl
   * - `javascript`: node, bun, npm, npx
   * - `python`: python, python3
   * - `archive`: tar
   * - `environment`: env, xargs
   */
  readonly capabilities?: ReadonlyArray<
    "github" | "web" | "javascript" | "python" | "archive" | "environment"
  >;
  /** Additional explicit command names to add on top of capabilities. */
  readonly commands?: ReadonlyArray<string>;
}

/**
 * Capability group name to the concrete commands it grants. This is the
 * table {@link resolveCommandAccess} reads for `commandAccess.capabilities`.
 *
 * Builders: render one toggle per key to offer grouped shell permissions.
 * The `github` group (`gh`) is also covered by the `git` toolset, so a UI
 * that already offers the `git` toolset need not show `github` separately.
 */
export const COMMAND_CAPABILITY_MAP: Readonly<Record<string, ReadonlyArray<string>>> = {
  github: ["gh"],
  web: ["curl"],
  javascript: ["node", "bun", "npm", "npx"],
  python: ["python", "python3"],
  archive: ["tar"],
  environment: ["env", "xargs"],
};

/**
 * Concrete command names a {@link ShellCommandAccessConfig} grants: the
 * capability groups expanded via {@link COMMAND_CAPABILITY_MAP}, plus
 * `commands`, deduplicated in first-seen order. Returns `[]` with no config.
 *
 * @example
 * ```ts
 * resolveCommandAccess({ capabilities: ["javascript"] }); // ["node", "bun", "npm", "npx"]
 * ```
 */
export function resolveCommandAccess(config?: ShellCommandAccessConfig): ReadonlyArray<string> {
  if (!config) return [];
  const fromCapabilities = (config.capabilities ?? []).flatMap(
    (capability) => COMMAND_CAPABILITY_MAP[capability] ?? [],
  );
  const fromCommands = config.commands ?? [];
  return [...new Set([...fromCapabilities, ...fromCommands])];
}
