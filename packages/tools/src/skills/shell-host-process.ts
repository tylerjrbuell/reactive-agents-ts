/**
 * Host-process execution for `shell-execute`: minimal environment, confined
 * HOME/TMPDIR, timeout kill. The policy checks run before this in
 * `shell-execution.ts`; this module only spawns an already-allowed command.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessGroup } from "./process-group.js";

/** Commit identity variables forwarded when git config is inherited. */
const GIT_IDENTITY_VARS = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

/**
 * The real user's global git config file, from the real environment: an
 * explicit `GIT_CONFIG_GLOBAL`, else `~/.gitconfig`, else
 * `$XDG_CONFIG_HOME/git/config` (default `~/.config/git/config`). The first
 * one that exists wins; `undefined` when there is none.
 */
export function realGitGlobalConfig(): string | undefined {
  const home = process.env.HOME;
  const xdg = process.env.XDG_CONFIG_HOME ?? (home ? join(home, ".config") : undefined);
  const candidates = [
    process.env.GIT_CONFIG_GLOBAL,
    home ? join(home, ".gitconfig") : undefined,
    xdg ? join(xdg, "git", "config") : undefined,
  ];
  return candidates.find((p): p is string => p !== undefined && existsSync(p));
}

/** stdout and stderr capped at the shell's output limit. */
export interface CappedShellOutput {
  readonly output: string;
  readonly truncated: boolean;
  readonly stderr: string;
  readonly stderrTruncated: boolean;
}

/** Cap stdout and stderr at `maxChars` each, flagging which one was cut. */
export function capShellOutput(stdout: string, stderr: string, maxChars: number): CappedShellOutput {
  return {
    output: stdout.length > maxChars ? stdout.slice(0, maxChars) : stdout,
    truncated: stdout.length > maxChars,
    stderr: stderr.length > maxChars ? stderr.slice(0, maxChars) : stderr,
    stderrTruncated: stderr.length > maxChars,
  };
}

/** One host shell invocation. */
export interface HostShellRequest {
  /** Validated command, run as `sh -c <command>`. */
  readonly command: string;
  /** Working directory of the process. */
  readonly cwd: string;
  /** `PATH` for the process. */
  readonly path: string;
  /** Kill the process after this many milliseconds. */
  readonly timeoutMs: number;
  /**
   * `true` when `cwd` is the handler's own throwaway sandbox: HOME and TMPDIR
   * point at it. `false` when `cwd` belongs to the caller (a workspace): HOME
   * and TMPDIR point at a fresh scratch dir outside it, removed after the call,
   * so `~`, dotfiles and tool caches never land in the user's project.
   */
  readonly homeInCwd: boolean;
  /**
   * `true`: git sees a copy of the real user's global git config (identity,
   * credential helpers) placed in the per-call HOME, plus the GIT_AUTHOR_* /
   * GIT_COMMITTER_* variables. A copy, so `git config --global` in the shell
   * never writes the user's real file.
   */
  readonly gitConfig?: boolean;
}

/** Raw process outcome, before truncation. */
export interface HostShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** `true` when the timeout fired and the process group was killed. */
  readonly timedOut: boolean;
}

/**
 * Build the minimal environment. HOME is always `home` (never the real home
 * directory), so shell expansion and `~` cannot reach real user files. Only
 * explicit token env vars are forwarded — never HOME, XDG dirs, or any other
 * path that could let the subprocess read real user files.
 *
 * For authenticated CLIs (gh, stripe, etc.) that store credentials under
 * $HOME/.config/<app>, we resolve the real config path once here and inject it
 * as the vendor-specific override variable (GH_CONFIG_DIR,
 * GOOGLE_WORKSPACE_CLI_CONFIG_DIR). This gives the CLI
 * access to its own credential store without exposing $HOME to shell expansion.
 *
 * `git` is set only when git config is inherited ({@link HostShellRequest.gitConfig}):
 * `globalConfig` is the per-call copy git should read as its global config.
 */
export function buildHostShellEnv(
  path: string,
  home: string,
  git?: { readonly globalConfig?: string },
): Record<string, string> {
  const inheritedEnv: Record<string, string> = {};

  // Pass auth tokens directly — these are scalars with no path-traversal risk.
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"] as const) {
    const val = process.env[key];
    if (val !== undefined) inheritedEnv[key] = val;
  }

  // Resolve the real gh config dir and inject it as GH_CONFIG_DIR so the
  // CLI can read stored credentials while HOME stays confined.
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    const realGhConfigDir =
      process.env.GH_CONFIG_DIR ??
      (process.env.XDG_CONFIG_HOME ? `${process.env.XDG_CONFIG_HOME}/gh` : null) ??
      (process.env.HOME ? `${process.env.HOME}/.config/gh` : null);
    if (realGhConfigDir) {
      inheritedEnv["GH_CONFIG_DIR"] = realGhConfigDir;
    }
  }

  // Google Workspace CLI (gws): same pattern. Its store defaults to
  // ~/.config/gws, which the confined HOME hides (calls fail 401 without it).
  for (const key of [
    "GOOGLE_WORKSPACE_CLI_TOKEN",
    "GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE",
    "GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND",
    "GOOGLE_WORKSPACE_PROJECT_ID",
  ] as const) {
    const val = process.env[key];
    if (val !== undefined) inheritedEnv[key] = val;
  }
  const realGwsConfigDir =
    process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR ??
    (process.env.XDG_CONFIG_HOME ? `${process.env.XDG_CONFIG_HOME}/gws` : null) ??
    (process.env.HOME ? `${process.env.HOME}/.config/gws` : null);
  if (realGwsConfigDir) inheritedEnv["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = realGwsConfigDir;

  // git (only when inherited): the per-call copy of the global config, plus
  // explicit commit identity variables.
  if (git !== undefined) {
    if (git.globalConfig !== undefined) inheritedEnv["GIT_CONFIG_GLOBAL"] = git.globalConfig;
    for (const key of GIT_IDENTITY_VARS) {
      const val = process.env[key];
      if (val !== undefined) inheritedEnv[key] = val;
    }
  }

  return { PATH: path, HOME: home, TMPDIR: home, LANG: "C.UTF-8", ...inheritedEnv };
}

/**
 * Model-facing marker for a timed-out run, spread into the shell-execute
 * result. Empty when the run finished in time, so normal results are unchanged.
 * `executed` stays `true`: the output gathered before the kill is still data.
 */
export function timeoutMarker(
  timedOut: boolean,
  timeoutMs: number,
): { readonly timedOut?: true; readonly note?: string } {
  if (!timedOut) return {};
  return {
    timedOut: true,
    note: `Command timed out after ${timeoutMs}ms and was killed; output is partial. The exit code reflects the kill, not the command.`,
  };
}

/** Copy the real global git config into `home`; its path, or `undefined` when the user has none. */
function copyGitConfig(home: string): string | undefined {
  const source = realGitGlobalConfig();
  if (source === undefined) return undefined;
  const copy = join(home, ".gitconfig");
  try {
    copyFileSync(source, copy);
    return copy;
  } catch {
    return undefined; // unreadable config: git runs without it, as before
  }
}

/**
 * Spawn `sh -c <command>` on the host and collect its output.
 *
 * The shell leads its own process group and the timeout kills the whole group
 * ({@link runProcessGroup}). Killing only `sh` left pipeline members and other
 * grandchildren alive; one holding stdout kept the read open past the kill.
 */
export async function runHostShell(req: HostShellRequest): Promise<HostShellResult> {
  // mkdtemp creates the dir with mode 0700 (CWE-377).
  const home = req.homeInCwd ? req.cwd : mkdtempSync(join(tmpdir(), "rax-shell-home-"));
  try {
    return await runProcessGroup({
      argv: ["sh", "-c", req.command],
      cwd: req.cwd,
      env: buildHostShellEnv(req.path, home, req.gitConfig === true ? { globalConfig: copyGitConfig(home) } : undefined),
      timeoutMs: req.timeoutMs,
    });
  } finally {
    if (!req.homeInCwd) rmSync(home, { recursive: true, force: true });
  }
}
