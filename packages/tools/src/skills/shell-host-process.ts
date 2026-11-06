/**
 * Host-process execution for `shell-execute`: minimal environment, confined
 * HOME/TMPDIR, timeout kill. The policy checks run before this in
 * `shell-execution.ts`; this module only spawns an already-allowed command.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "@reactive-agents/runtime-shim";

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
}

/** Raw process outcome, before truncation. */
export interface HostShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Build the minimal environment. HOME is always `home` (never the real home
 * directory), so shell expansion and `~` cannot reach real user files. Only
 * explicit token env vars are forwarded — never HOME, XDG dirs, or any other
 * path that could let the subprocess read real user files.
 *
 * For authenticated CLIs (gh, stripe, etc.) that store credentials under
 * $HOME/.config/<app>, we resolve the real config path once here and inject it
 * as the vendor-specific override variable (GH_CONFIG_DIR). This gives the CLI
 * access to its own credential store without exposing $HOME to shell expansion.
 */
export function buildHostShellEnv(path: string, home: string): Record<string, string> {
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

  return { PATH: path, HOME: home, TMPDIR: home, LANG: "C.UTF-8", ...inheritedEnv };
}

/** Spawn `sh -c <command>` on the host and collect its output. */
export async function runHostShell(req: HostShellRequest): Promise<HostShellResult> {
  // mkdtemp creates the dir with mode 0700 (CWE-377).
  const home = req.homeInCwd ? req.cwd : mkdtempSync(join(tmpdir(), "rax-shell-home-"));
  try {
    const proc = spawn(["sh", "-c", req.command], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: req.cwd,
      env: buildHostShellEnv(req.path, home),
    });

    const timeoutId = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Process may already have exited
      }
    }, req.timeoutMs);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    clearTimeout(timeoutId);
    return { stdout, stderr, exitCode };
  } finally {
    if (!req.homeInCwd) rmSync(home, { recursive: true, force: true });
  }
}
