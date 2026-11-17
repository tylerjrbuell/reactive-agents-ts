import { Effect } from "effect";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { ToolExecutionError, toToolError } from "../errors.js";
import { makeDockerSandbox, runSandboxEffect } from "../execution/docker-sandbox.js";
import type { RunnerLanguage, DockerSandboxConfig } from "../execution/docker-sandbox.js";
import { sandboxDockerEnabled } from "../flags.js";
import { capShellOutput, runHostShell, timeoutMarker } from "./shell-host-process.js";
import { GIT_BLOCKED_RULES } from "./shell-git-guard.js";
import { SCRIPT_BLOCKED_RULES } from "./shell-program-guard.js";
import type { ShellGitReadOnlyConfig } from "./shell-git-readonly.js";
import { checkShellInput, findDisallowedCommand, type ShellInputPolicy } from "./shell-input-denial.js";
import {
  DEFAULT_ALLOWED_COMMANDS,
  resolveCommandAccess,
  type ShellCommandAccessConfig,
} from "./shell-command-catalog.js";

// Sanitizer + allow-list scan live in ./shell-input-denial.ts; re-exported for existing importers.
export { findDisallowedCommand, sanitizeCommand } from "./shell-input-denial.js";

// Command catalog lives in ./shell-command-catalog.ts; re-exported for existing importers.
export {
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  COMMAND_CAPABILITY_MAP,
  resolveCommandAccess,
  type ShellCommandAccessConfig,
} from "./shell-command-catalog.js";

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Blocked patterns — checked against the full command string.
 *
 * Each entry is compiled to a RegExp at module load so we pay the cost
 * once. The patterns are designed to catch:
 *
 * 1. Recursive forced deletion (`rm -rf`, `rm -f -r`, `rm --force --recursive`)
 * 2. Privilege escalation (`sudo`)
 * 3. Dangerous permission changes (`chmod 777`, `chown`)
 * 4. Shell injection (`eval`, `$()`, backticks)
 * 5. Pipe-to-shell (`| sh`, `| bash`, `| zsh`)
 * 6. Writes to sensitive system paths (`/etc/`, `/dev/`; a redirect to exactly `/dev/null` is exempt)
 * 7. Disk/partition tools (`mkfs`, `fdisk`, `dd`)
 * 8. Process manipulation (`kill`, `killall`)
 * 9. Persistent background processes (`nohup`, `disown`)
 * 10. Cron/scheduled tasks (`crontab`)
 * 11. Chained destructive subcommands via `&&`, `;`, `||`
 */
/**
 * Labelled blocked-command rule. The `reason` is surfaced in error messages
 * so callers know *which* policy fired (e.g. "find -exec is blocked — use
 * `find | xargs` instead").
 */
export interface BlockedCommandRule {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Single source of truth for default block-list rules. Each entry pairs a
 * regex with a human-readable reason. Order matters only for the *reported*
 * reason when multiple rules match (the first match wins).
 */
export const DEFAULT_BLOCKED_RULES: ReadonlyArray<BlockedCommandRule> = [
  // rm with force/recursive flags in any order
  { pattern: /\brm\b.*-[^\s]*r[^\s]*f/i, reason: "rm with -rf flags is destructive" },
  { pattern: /\brm\b.*-[^\s]*f[^\s]*r/i, reason: "rm with -fr flags is destructive" },
  { pattern: /\brm\b.*--recursive/i, reason: "rm --recursive is destructive" },
  { pattern: /\brm\b.*--force/i, reason: "rm --force is destructive" },
  // rm as a standalone command (blocked entirely — too dangerous)
  { pattern: /(?:^|\s|[;&|])\s*rm\s/i, reason: "rm is blocked — there is no file-delete tool; overwrite with file-write or leave the file" },
  // Privilege escalation
  { pattern: /(?:^|\s|[;&|])\s*sudo\b/i, reason: "sudo (privilege escalation) is blocked" },
  // Dangerous permissions
  { pattern: /\bchmod\s+7[0-7]{2}\b/i, reason: "chmod 7xx grants world-writable permissions" },
  { pattern: /(?:^|\s|[;&|])\s*chown\b/i, reason: "chown is blocked" },
  // Shell injection
  { pattern: /(?:^|\s|[;&|])\s*eval\b/i, reason: "eval enables shell injection (CWE-78)" },
  { pattern: /\$\(/, reason: "$(...) command substitution is blocked (shell injection)" },
  { pattern: /`[^`]*`/, reason: "backtick command substitution is blocked (shell injection)" },
  // Pipe to shell interpreters
  { pattern: /\|\s*(sh|bash|zsh|dash|ksh|csh)\b/i, reason: "piping to a shell interpreter is blocked (curl|sh pattern)" },
  // Writes to sensitive system paths via redirect
  { pattern: />\s*\/etc\//i, reason: "writes to /etc/ are blocked" },
  { pattern: />\s*\/dev\//i, reason: "writes to /dev/ are blocked" },
  { pattern: />\s*\/usr\//i, reason: "writes to /usr/ are blocked" },
  { pattern: />\s*\/boot\//i, reason: "writes to /boot/ are blocked" },
  { pattern: />\s*\/sys\//i, reason: "writes to /sys/ are blocked" },
  { pattern: />\s*\/proc\//i, reason: "writes to /proc/ are blocked" },
  { pattern: />\s*\/var\/(log|run|spool)\//i, reason: "writes to /var/log|run|spool are blocked" },
  // Disk/partition tools
  { pattern: /(?:^|\s|[;&|])\s*mkfs\b/i, reason: "mkfs (filesystem creation) is blocked" },
  { pattern: /(?:^|\s|[;&|])\s*fdisk\b/i, reason: "fdisk (partition tool) is blocked" },
  { pattern: /(?:^|\s|[;&|])\s*dd\b/i, reason: "dd (raw disk write) is blocked" },
  // Process manipulation
  { pattern: /(?:^|\s|[;&|])\s*kill\b/i, reason: "kill is blocked" },
  { pattern: /(?:^|\s|[;&|])\s*killall\b/i, reason: "killall is blocked" },
  // Persistent background processes
  { pattern: /(?:^|\s|[;&|])\s*nohup\b/i, reason: "nohup (persistent background process) is blocked" },
  { pattern: /(?:^|\s|[;&|])\s*disown\b/i, reason: "disown (persistent background process) is blocked" },
  // Crontab
  { pattern: /(?:^|\s|[;&|])\s*crontab\b/i, reason: "crontab is blocked" },
  // awk/sed shell escapes + sort --compress-program (legacy labels; the parsed boundary is scriptEscapeDenial)
  ...SCRIPT_BLOCKED_RULES,
  // Process substitution `<(...)` / `>(...)` — the inner command executes on the host (RCE)
  { pattern: /[<>]\(/, reason: "process substitution <(...)/>(...) is blocked (shell injection)" },
  // find -exec/-execdir/-ok — arbitrary command execution through find (CWE-78)
  { pattern: /\bfind\b.*\s-exec\b/i, reason: "find -exec is blocked (CWE-78) — pipe to xargs instead, e.g. `find . -name '*.ts' | xargs wc -l`" },
  { pattern: /\bfind\b.*\s-execdir\b/i, reason: "find -execdir is blocked (CWE-78) — pipe to xargs instead" },
  { pattern: /\bfind\b.*\s-ok\b/i, reason: "find -ok is blocked (CWE-78) — pipe to xargs instead" },
  // find -delete — file deletion through find
  { pattern: /\bfind\b.*\s-delete\b/i, reason: "find -delete is blocked — there is no file-delete tool; overwrite via file-write or leave the file" },
  // git options that run code: -c, --config, --upload-pack, --receive-pack, clone -u, --exec-path=
  ...GIT_BLOCKED_RULES,
  // Background operator & (CWE-400): escapes timeout, spawns unmanaged process.
  // Negative lookbehind ensures && (legitimate chaining) is not matched.
  { pattern: /(?<!&)&\s*$/, reason: "trailing & (background operator) is blocked — escapes timeout" },
  // ${...} variable interpolation (CWE-78): indirect injection via parameter expansion
  { pattern: /\$\{/, reason: "${...} parameter expansion is blocked (CWE-78)" },
];

/**
 * Back-compat: pattern-only view of {@link DEFAULT_BLOCKED_RULES}. Prefer
 * the labelled rules when you need an actionable error message.
 */
export const DEFAULT_BLOCKED_PATTERNS: ReadonlyArray<RegExp> = DEFAULT_BLOCKED_RULES.map(
  (rule) => rule.pattern,
);

// Sanitizer + allow-list scan (sanitizeCommand, findDisallowedCommand): ./shell-input-denial.ts.

/**
 * Check whether every command in a (potentially chained) pipeline is
 * in the allow-list.
 *
 * Splits on `&&`, `||`, `;`, and `|` so that `echo ok && wget evil.com`
 * correctly rejects `wget`. Also extracts the basename of absolute-path
 * binaries so that `/usr/bin/wget` → `wget` → rejected.
 */
export function isCommandAllowed(
  command: string,
  allowList: ReadonlyArray<string> = DEFAULT_ALLOWED_COMMANDS,
): boolean {
  return findDisallowedCommand(command, allowList) === null;
}

/**
 * Find the first blocked-rule match for `command` and return its reason.
 * Returns `null` if no rule matches. Used to build actionable error
 * messages — `find . -exec ...` should report "find -exec is blocked
 * (CWE-78) — pipe to xargs instead" rather than a generic refusal.
 */
export function findBlockedReason(
  command: string,
  rules: ReadonlyArray<BlockedCommandRule> = DEFAULT_BLOCKED_RULES,
): string | null {
  for (const rule of rules) {
    if (rule.pattern.test(command)) return rule.reason;
  }
  return null;
}

/**
 * Check whether the command matches any blocked pattern.
 */
export function isCommandBlocked(
  command: string,
  blockList: ReadonlyArray<RegExp> = DEFAULT_BLOCKED_PATTERNS,
): boolean {
  return blockList.some((pattern) => pattern.test(command));
}

// ── Config ────────────────────────────────────────────────────────────

/** Audit log entry emitted for every command attempt. */
export interface ShellAuditEntry {
  readonly command: string;
  readonly allowed: boolean;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly timestamp: number;
}

/**
 * Resolve host PATH directories for explicitly opted-in commands.
 *
 * This keeps the default shell PATH strict while allowing developers to opt
 * in specific CLIs that are installed in user-local global bin directories
 * (for example, ~/.bun/bin or npm global bin paths).
 */
function resolveCommandDirectories(commands: ReadonlyArray<string>): ReadonlyArray<string> {
  const hostPath = process.env.PATH;
  if (!hostPath || commands.length === 0) return [];

  const safeCommandName = /^[A-Za-z0-9._-]+$/;
  const dirs = new Set<string>();

  for (const commandName of commands) {
    if (!safeCommandName.test(commandName)) continue;
    const lookup = spawnSync("sh", ["-c", "command -v \"$1\"", "sh", commandName], {
      encoding: "utf8",
      env: { PATH: hostPath },
    });

    if (lookup.status !== 0) continue;
    const binaryPath = lookup.stdout.trim().split("\n")[0]?.trim();
    if (!binaryPath || !binaryPath.startsWith("/")) continue;

    const lastSlash = binaryPath.lastIndexOf("/");
    if (lastSlash <= 0) continue;
    dirs.add(binaryPath.slice(0, lastSlash));
  }

  return [...dirs];
}

/** Configuration for the shell-execute handler factory. */
export interface ShellExecuteConfig extends ShellGitReadOnlyConfig {
  /** Working directory. Must be under /tmp unless `allowUnsafeCwd` is true. */
  readonly cwd?: string;
  /** Maximum characters to return in output (default: 4000). */
  readonly maxOutputChars?: number;
  /** Timeout in ms before the process is killed (default: 30 000). */
  readonly timeoutMs?: number;
  /** Custom allow-list (overrides default). */
  readonly allowedCommands?: ReadonlyArray<string>;
  /** Custom block-list (overrides default). */
  readonly blockedPatterns?: ReadonlyArray<RegExp>;
  /**
   * Additional commands to allow on top of the base list.
   *
   * Use this to grant agents access to specific CLIs (e.g. `"gh"`, `"stripe"`,
   * `"docker"`) without replacing the entire default allow-list. These commands
   * are merged with `allowedCommands` (or defaults if `allowedCommands` is absent).
   *
   * **The developer takes ownership and liability for any command granted here.**
   */
  readonly additionalCommands?: ReadonlyArray<string>;
  /**
   * Higher-level command-access abstraction for common command groups.
   *
   * This merges with `additionalCommands` and is purely additive.
   */
  readonly commandAccess?: ShellCommandAccessConfig;
  /** If true, allows `cwd` outside /tmp. Use with extreme caution. */
  readonly allowUnsafeCwd?: boolean;
  /** Host mode: git gets a per-call global config with only the user's name and email (skills/shell-git-env.ts). Set by `scopedShellConfig` when git is allowed. */
  readonly inheritGitConfig?: boolean;
  /**
   * Execution substrate (F1b). `"host"` (default) runs the command in the
   * process sandbox with the input filters. `"docker"` opts into running the
   * command inside a hardened, throwaway container (no network, read-only
   * rootfs, ephemeral tmpfs workdir, cap-drop ALL, non-root, seccomp) for added
   * isolation — an escape is confined to the container and cannot touch the
   * host. Requires Docker; if unavailable the call fails closed rather than
   * silently downgrading. Files are ephemeral (no host directory is mounted).
   * Also settable globally via `RA_SANDBOX=docker`.
   */
  readonly sandbox?: "host" | "docker";
  /**
   * Audit callback invoked for every command attempt (allowed or rejected).
   * Use for OWASP-compliant security logging.
   */
  readonly onAudit?: (entry: ShellAuditEntry) => void;
  /**
   * Docker escalation config. When enabled, commands that invoke runtime
   * interpreters (node, bun, python) from `additionalCommands` are
   * automatically routed through the Docker sandbox for full isolation.
   *
   * Requires Docker daemon access. Falls back to process sandbox if
   * Docker is unavailable.
   *
   * @example
   * ```ts
   * shellExecuteHandler({
   *   additionalCommands: ["node", "python3"],
   *   dockerEscalation: { enabled: true },
   * })
   * ```
   */
  readonly dockerEscalation?: {
    readonly enabled: boolean;
    /** Override Docker sandbox configuration. */
    readonly config?: Partial<DockerSandboxConfig>;
  };
}

// Tool definition: config-built in ./shell-execute-definition.ts.

// ── Handler factory ───────────────────────────────────────────────────

/** Commands granted on top of the base list: `additionalCommands` plus `commandAccess` groups. */
function grantedCommands(config?: ShellExecuteConfig): string[] {
  return [...(config?.additionalCommands ?? []), ...resolveCommandAccess(config?.commandAccess)];
}

/**
 * The input policy a resolved config enforces. Shared by the handler and the
 * tool's `preflight` so both refuse with the same text. A caller-supplied
 * `blockedPatterns` has no labels, so its refusals use a generic reason.
 */
export function shellInputPolicyFor(config?: ShellExecuteConfig): ShellInputPolicy {
  return {
    allowedCommands: [...(config?.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS), ...grantedCommands(config)],
    blockedRules: config?.blockedPatterns
      ? config.blockedPatterns.map((pattern) => ({ pattern, reason: "matches custom blocklist pattern" }))
      : DEFAULT_BLOCKED_RULES,
    customBlocklist: config?.blockedPatterns !== undefined,
    gitReadOnly: config?.gitReadOnly === true,
    ...(config?.approvalCommands ? { approvalCommands: config.approvalCommands } : {}),
  };
}

/**
 * Create a shell-execute handler with the given configuration.
 *
 * Returns a function `(args) => Effect<unknown, ToolExecutionError>`.
 *
 * **Security model:**
 * 1. Command sanitized (null bytes, ANSI, length limit)
 * 2. Allow-list check on the first word (executable name)
 * 3. Block-list regex scan on the full command
 * 4. Path analysis to detect references outside the sandbox
 * 5. cwd confined to /tmp unless opt-out via `allowUnsafeCwd`
 * 6. Minimal environment — HOME/API keys stripped
 * 7. Timeout kills runaway processes
 * 8. Output truncated to prevent context flooding
 *
 * **Failure contract:** every policy/input denial returns
 * `{ executed: false, success: false, error }` — ToolService.execute reads the
 * flag and surfaces denials as failed observations, not defects. Commands that
 * RUN and exit non-zero keep `executed: true` (the exit code is data).
 */
export function shellExecuteHandler(
  config?: ShellExecuteConfig,
): (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError> {
  const maxOutputChars = config?.maxOutputChars ?? 4000;
  const timeoutMs = config?.timeoutMs ?? 30_000;
  const inputPolicy = shellInputPolicyFor(config);
  const allowedCommands = inputPolicy.allowedCommands;
  const additional = grantedCommands(config);
  const resolvedCommandDirs = resolveCommandDirectories(additional);
  const executionPath = [
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...resolvedCommandDirs,
  ].join(":");
  const allowUnsafeCwd = config?.allowUnsafeCwd ?? false;
  const onAudit = config?.onAudit;

  // ── Docker escalation setup ──
  // Commands matching runtime interpreters are routed through Docker sandbox
  // for full isolation (no host filesystem access, no network, seccomp, etc.)
  const dockerEscalation = config?.dockerEscalation;
  const dockerSandbox = dockerEscalation?.enabled
    ? makeDockerSandbox({
        timeoutMs,
        maxOutputChars,
        ...dockerEscalation.config,
      })
    : null;

  // ── Opt-in Docker sandbox (F1b) ──
  // When enabled (config.sandbox: "docker" or RA_SANDBOX=docker), the validated
  // command runs inside a hardened throwaway container instead of on the host.
  const useDockerSandbox =
    (config?.sandbox ?? (sandboxDockerEnabled() ? "docker" : "host")) === "docker";
  const shellDockerSandbox = useDockerSandbox
    ? makeDockerSandbox({ timeoutMs, maxOutputChars, ...dockerEscalation?.config })
    : null;

  /** Map of command names to Docker sandbox RunnerLanguage. */
  const DOCKER_ESCALATION_MAP: Record<string, RunnerLanguage> = {
    node: "node",
    bun: "bun",
    python: "python",
    python3: "python",
  };

  /**
   * Detect if a command should escalate to Docker.
   * Returns the language and code if escalatable, null otherwise.
   */
  const detectDockerEscalation = (
    command: string,
  ): { language: RunnerLanguage; code: string } | null => {
    if (!dockerSandbox) return null;
    const parts = command.trim().split(/\s+/);
    const executable = parts[0];
    if (!executable) return null;
    const basename = executable.includes("/") ? executable.split("/").pop()! : executable;
    const language = DOCKER_ESCALATION_MAP[basename];
    if (!language) return null;

    // Extract code from --eval, -e, or -c flags
    const evalFlags = ["--eval", "-e", "-c"];
    for (let i = 1; i < parts.length; i++) {
      if (evalFlags.includes(parts[i]!) && parts[i + 1]) {
        // Rejoin the rest as code (may contain spaces in the original command)
        const flagIndex = command.indexOf(parts[i]!);
        const codeStart = command.indexOf(parts[i + 1]!, flagIndex + parts[i]!.length);
        let code = command.slice(codeStart).trim();
        // Strip surrounding quotes — shell would strip these but we're parsing raw
        if ((code.startsWith('"') && code.endsWith('"')) ||
            (code.startsWith("'") && code.endsWith("'"))) {
          code = code.slice(1, -1);
        }
        return { language, code };
      }
    }

    // If no eval flag, the rest of the command after the executable is the file/code
    // Don't escalate file execution — only inline code
    return null;
  };

  /** Emit an audit entry (fire-and-forget, never throws). */
  const audit = (entry: Omit<ShellAuditEntry, "timestamp">) => {
    if (!onAudit) return;
    try {
      onAudit({ ...entry, timestamp: Date.now() });
    } catch {
      // Audit callback must never crash the handler
    }
  };

  // Resolve sandbox directory: default to a unique /tmp subdirectory.
  const sandboxDir = (() => {
    const requested = config?.cwd;
    if (requested) {
      // When a cwd is provided, validate it's under /tmp (unless opted out)
      if (!allowUnsafeCwd && !requested.startsWith("/tmp")) {
        return null; // will emit error at call time
      }
      return requested;
    }
    // Generate a unique sandbox directory under /tmp with restrictive permissions (CWE-377)
    const dir = join("/tmp", `rax-sandbox-${randomUUID()}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  })();

  return (args: Record<string, unknown>) =>
    Effect.tryPromise({
      try: async (signal) => {
        // ── 0–4. Input policy (shell-input-denial.ts): type, sandbox dir, sanitize,
        // allow-list, block-list, expansion, script, git read-only, path confinement ──
        const verdict = checkShellInput(args, inputPolicy, sandboxDir);
        if (verdict.denied) {
          if (verdict.audit) audit({ command: verdict.audit.command, allowed: false, reason: verdict.audit.reason });
          return { executed: false, success: false, error: verdict.error };
        }
        const command = verdict.command;
        const cwd = sandboxDir!; // a null directory was denied by checkShellInput above

        // ── 4a. Opt-in Docker sandbox (F1b) ──
        // The command passed every input filter above; now run it inside a
        // hardened, throwaway container. Fails closed if Docker is unavailable.
        if (shellDockerSandbox) {
          audit({ command, allowed: true, reason: "docker-sandbox" });
          const dockerResult = await runSandboxEffect(signal, // cancel reaches the container
            shellDockerSandbox.executeShell(command).pipe(
              Effect.catchAll((err) =>
                Effect.succeed({
                  output: "",
                  stderr: err.message,
                  exitCode: 1,
                  durationMs: 0,
                  truncated: false,
                  image: "unavailable",
                }),
              ),
            ),
          );
          return {
            executed: dockerResult.exitCode === 0,
            output: dockerResult.output || "(no output)",
            stderr: dockerResult.stderr,
            exitCode: dockerResult.exitCode,
            truncated: dockerResult.truncated,
            dockerSandboxed: true,
            image: dockerResult.image,
            ...(dockerResult.exitCode !== 0
              ? { error: dockerResult.stderr || `Process exited with code ${dockerResult.exitCode}` }
              : {}),
          };
        }

        // ── 4b. Docker escalation for runtime interpreters ──
        // When dockerEscalation is enabled, node/bun/python --eval commands
        // are routed through the hardened Docker sandbox instead of sh -c.
        const escalation = detectDockerEscalation(command);
        if (escalation && dockerSandbox) {
          audit({ command, allowed: true, reason: "docker-escalated" });
          try {
            const dockerResult = await runSandboxEffect(signal, // cancel reaches the container
              dockerSandbox.execute(escalation.code, escalation.language).pipe(
                Effect.catchAll((err) =>
                  Effect.succeed({
                    output: "",
                    stderr: err.message,
                    exitCode: 1,
                    durationMs: 0,
                    truncated: false,
                    image: "unknown",
                  }),
                ),
              ),
            );
            return {
              executed: dockerResult.exitCode === 0,
              output: dockerResult.output || "(no output)",
              stderr: dockerResult.stderr,
              exitCode: dockerResult.exitCode,
              truncated: dockerResult.truncated,
              dockerEscalated: true,
              image: dockerResult.image,
              ...(dockerResult.exitCode !== 0
                ? { error: dockerResult.stderr || `Process exited with code ${dockerResult.exitCode}` }
                : {}),
            };
          } catch (e) {
            if (signal.aborted) return { executed: false, success: false, error: "Cancelled" }; // Docker failed — fall through to host process execution, never after cancel
            audit({ command, allowed: true, reason: "docker-escalation-fallback" });
          }
        }

        // ── 5. Ensure sandbox directory exists ──
        if (!existsSync(cwd)) {
          mkdirSync(cwd, { recursive: true, mode: 0o700 });
        }

        // ── 6–7. Host process: minimal env, timeout kill (shell-host-process.ts) ──
        // HOME/TMPDIR never reach the real home. A caller-supplied cwd (a
        // workspace) gets a scratch HOME outside it; the own sandbox is HOME.
        const { stdout: fullOutput, stderr: fullStderr, exitCode, timedOut } = await runHostShell({
          command,
          cwd,
          path: executionPath,
          timeoutMs,
          homeInCwd: config?.cwd === undefined,
          gitConfig: config?.inheritGitConfig === true,
          gitReadOnly: config?.gitReadOnly === true, granted: allowedCommands,
        });

        // ── 8. Truncation (stdout + stderr): shell-host-process.ts ──
        const { output, truncated, stderr, stderrTruncated } = capShellOutput(fullOutput, fullStderr, maxOutputChars);

        // ── 9. Audit log ──
        audit({ command, allowed: true, exitCode });

        return {
          executed: true,
          output,
          ...(truncated ? { fullOutput } : {}),
          stderr,
          ...(stderrTruncated ? { fullStderr } : {}),
          exitCode, ...timeoutMarker(timedOut, timeoutMs), // timed-out runs: timedOut + note
          truncated,
          stderrTruncated,
        };
      },
      catch: toToolError("shell-execute", "Shell execution"),
    });
}
