/**
 * Host-process execution for `shell-execute`: minimal environment, confined
 * HOME/TMPDIR, timeout kill. The policy checks run before this in
 * `shell-execution.ts`; this module only spawns an already-allowed command.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcessGroup } from "./process-group.js";
import { prepareGitShellFiles, readOnlyGitEnv } from "./shell-git-env.js";

// git config discovery and the minimal per-call config live in ./shell-git-env.ts.
export { realGitGlobalConfig } from "./shell-git-env.js";

/** Commit identity variables forwarded when git config is inherited. */
const GIT_IDENTITY_VARS = [
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

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
   * `true`: git's global config is a per-call file with only the real user's
   * `user.name` / `user.email` (skills/shell-git-env.ts), plus the
   * GIT_AUTHOR_* / GIT_COMMITTER_* variables. Aliases, credential helpers and
   * URL rewrites are not passed. The file lives in its own temporary
   * directory (not HOME) and is removed after the call, so
   * `git config --global` never writes the user's real file.
   */
  readonly gitConfig?: boolean;
  /**
   * `true` (read-only git/gh preset, with `gitConfig`): no system config,
   * hooks pointed at an empty directory and fsmonitor off, overriding the
   * repository's own config.
   */
  readonly gitReadOnly?: boolean;
  /** Commands the shell may run; gh / gws credentials are forwarded only if granted. */
  readonly granted?: ReadonlyArray<string>;
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
 * `granted` is the set of commands the shell may run: gh and gws credentials
 * (tokens, config dirs) are forwarded only when `gh` / `gws` is in it.
 *
 * `git` is set only when git config is inherited ({@link HostShellRequest.gitConfig}):
 * `globalConfig` is the per-call minimal config git reads as its global
 * config; `hooksPath` (read-only preset) adds {@link readOnlyGitEnv}.
 */
export function buildHostShellEnv(
  path: string,
  home: string,
  git?: { readonly globalConfig?: string; readonly hooksPath?: string },
  granted: ReadonlyArray<string> = [],
): Record<string, string> {
  const inheritedEnv: Record<string, string> = {};
  const grantsGh = granted.includes("gh");
  const grantsGws = granted.includes("gws");

  // Pass auth tokens directly — these are scalars with no path-traversal risk.
  // Only to a shell that was granted `gh`: any allow-listed command (`jq env`,
  // `awk ENVIRON`) can print the environment, so an ungranted token stays out.
  for (const key of grantsGh ? (["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"] as const) : []) {
    const val = process.env[key];
    if (val !== undefined) inheritedEnv[key] = val;
  }

  // Resolve the real gh config dir and inject it as GH_CONFIG_DIR so the
  // CLI can read stored credentials while HOME stays confined.
  if (grantsGh && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
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
  for (const key of grantsGws
    ? ([
        "GOOGLE_WORKSPACE_CLI_TOKEN",
        "GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE",
        "GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND",
        "GOOGLE_WORKSPACE_PROJECT_ID",
      ] as const)
    : []) {
    const val = process.env[key];
    if (val !== undefined) inheritedEnv[key] = val;
  }
  const realGwsConfigDir =
    process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR ??
    (process.env.XDG_CONFIG_HOME ? `${process.env.XDG_CONFIG_HOME}/gws` : null) ??
    (process.env.HOME ? `${process.env.HOME}/.config/gws` : null);
  if (grantsGws && realGwsConfigDir) inheritedEnv["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = realGwsConfigDir;

  // git (only when inherited): the per-call minimal global config, explicit
  // commit identity variables and, for the read-only preset, hooks/fsmonitor off.
  if (git !== undefined) {
    if (git.globalConfig !== undefined) inheritedEnv["GIT_CONFIG_GLOBAL"] = git.globalConfig;
    for (const key of GIT_IDENTITY_VARS) {
      const val = process.env[key];
      if (val !== undefined) inheritedEnv[key] = val;
    }
    if (git.hooksPath !== undefined) Object.assign(inheritedEnv, readOnlyGitEnv(git.hooksPath));
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
  const git = req.gitConfig === true ? prepareGitShellFiles(req.gitReadOnly === true) : undefined;
  try {
    return await runProcessGroup({
      argv: ["sh", "-c", req.command],
      cwd: req.cwd,
      env: buildHostShellEnv(req.path, home, git, req.granted),
      timeoutMs: req.timeoutMs,
    });
  } finally {
    if (git !== undefined) rmSync(git.dir, { recursive: true, force: true });
    if (!req.homeInCwd) rmSync(home, { recursive: true, force: true });
  }
}
