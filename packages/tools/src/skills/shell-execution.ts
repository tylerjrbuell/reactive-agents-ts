import { Effect } from "effect";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { spawn } from "@reactive-agents/runtime-shim";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { makeDockerSandbox } from "../execution/docker-sandbox.js";
import type { RunnerLanguage, DockerSandboxConfig } from "../execution/docker-sandbox.js";

// ── Constants ─────────────────────────────────────────────────────────

/** Maximum command length to prevent abuse via enormous strings. */
const MAX_COMMAND_LENGTH = 4096;

/**
 * Default allow-listed command prefixes.
 *
 * Only the first word of the command (the executable name) is checked.
 * `rm`, `chmod`, `chown` are excluded intentionally — file deletion and
 * permission changes are too destructive for an agent sandbox.
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
 * 6. Writes to sensitive system paths (`/etc/`, `/dev/`)
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
  { pattern: /(?:^|\s|[;&|])\s*rm\s/i, reason: "rm is blocked — use the file-write tool to manage files" },
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
  // awk shell escape — system() executes arbitrary commands
  { pattern: /\bawk\b.*\bsystem\s*\(/i, reason: "awk system() enables shell injection" },
  // awk getline — reads from an arbitrary file or command (`getline < "file"`, `"cmd" | getline`)
  { pattern: /\bawk\b.*\bgetline\b/i, reason: "awk getline (arbitrary file/command read) is blocked" },
  // awk print-pipe — `print ... | "cmd"` pipes awk output to a shell command
  { pattern: /\bawk\b.*\|\s*"/i, reason: "awk print-pipe to a command is blocked (shell injection)" },
  // Process substitution `<(...)` / `>(...)` — the inner command executes on the host (RCE)
  { pattern: /[<>]\(/, reason: "process substitution <(...)/>(...) is blocked (shell injection)" },
  // sed execute flag — runs replacement as shell command (s/pat/repl/e)
  { pattern: /\bsed\b.*\/e\b/i, reason: "sed /e flag enables shell injection" },
  // find -exec/-execdir/-ok — arbitrary command execution through find (CWE-78)
  { pattern: /\bfind\b.*\s-exec\b/i, reason: "find -exec is blocked (CWE-78) — pipe to xargs instead, e.g. `find . -name '*.ts' | xargs wc -l`" },
  { pattern: /\bfind\b.*\s-execdir\b/i, reason: "find -execdir is blocked (CWE-78) — pipe to xargs instead" },
  { pattern: /\bfind\b.*\s-ok\b/i, reason: "find -ok is blocked (CWE-78) — pipe to xargs instead" },
  // find -delete — file deletion through find
  { pattern: /\bfind\b.*\s-delete\b/i, reason: "find -delete is blocked (use file-write tool to remove files)" },
  // git config-based code execution (CWE-78): -c injects config that runs code
  { pattern: /\bgit\b.*\s-c\s/i, reason: "git -c is blocked (CWE-78 — config injection)" },
  // git clone --config — same vector via clone
  { pattern: /\bgit\b.*--config\b/i, reason: "git --config is blocked (CWE-78)" },
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

// ── Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize a command string: strip null bytes, ANSI escapes, newlines,
 * carriage returns, and enforce a maximum length. Returns empty string
 * for excessively long commands (which will then be rejected as empty).
 */
export function sanitizeCommand(raw: string): string {
  if (raw.length > MAX_COMMAND_LENGTH) return "";
  return raw
    .replace(/\x00/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    // Strip newlines and carriage returns — prevents CWE-78 newline injection
    .replace(/[\r\n]+/g, " ")
    .trim();
}

// ── Validation helpers ────────────────────────────────────────────────

/**
 * Split a (potentially chained) command pipeline into segments on `&&`,
 * `||`, `;`, and `|` — but only outside quoted strings so jq filters like
 * `'.[] | .field'` are preserved.
 */
function splitCommandSegments(trimmed: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    const next = i + 1 < trimmed.length ? trimmed[i + 1] : "";

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    const outsideQuotes = !inSingleQuote && !inDoubleQuote;
    if (outsideQuotes) {
      if (ch === ";" || ch === "|") {
        segments.push(current.trim());
        current = "";
        continue;
      }
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
        segments.push(current.trim());
        current = "";
        i += 1; // consume second operator char
        continue;
      }
    }

    current += ch;
  }
  segments.push(current.trim());
  return segments;
}

/**
 * Find the first pipe/chain segment whose executable is not in the
 * allow-list. Returns the offender's basename, or `null` if every
 * segment is allowed. Empty input returns the sentinel `""` so callers
 * can distinguish "no command" from "all allowed".
 *
 * Used to build precise error messages — `find . | xargs wc` should
 * report `xargs` (the actual offender), not `find` (the first word).
 */
export function findDisallowedCommand(
  command: string,
  allowList: ReadonlyArray<string> = DEFAULT_ALLOWED_COMMANDS,
): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "";

  const segments = splitCommandSegments(trimmed);

  let hasCommand = false;
  for (const segment of segments) {
    const seg = segment.trim();
    if (!seg) continue;
    hasCommand = true;
    const firstWord = seg.split(/\s+/)[0]!;
    // Extract basename to prevent absolute-path bypass:
    // /usr/bin/wget → wget → not in defaults → blocked
    const name = firstWord.includes("/") ? firstWord.split("/").pop()! : firstWord;
    if (!allowList.includes(name)) return name;
  }

  return hasCommand ? null : "";
}

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

/**
 * Detect shell expansion / substitution that this tool does not support.
 *
 * shell-execute runs commands literally inside a sandbox; parameter expansion
 * (`$VAR`, `${VAR}`), command substitution (`$(…)`, backticks), and process
 * substitution (`<(…)`, `>(…)`) are all injection vectors with no legitimate
 * use here. This scan is **quote-aware**: single quotes suppress every form of
 * shell expansion, so `awk '{print $NF}'` and `echo 'costs $5'` are allowed,
 * while `cat $VAR`, `cat "$VAR"`, and `cat <(id)` are rejected structurally
 * (a policy on the expansion class, not an enumerated blocklist of commands).
 *
 * Returns an error message if unsafe, or `null` if safe.
 */
function detectShellExpansion(command: string): string | null {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    const next = i + 1 < command.length ? command[i + 1]! : "";

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    // Single quotes suppress all shell expansion — skip their contents.
    if (inSingle) continue;

    // $VAR / ${VAR} / $(...) — variable and command substitution.
    // A `$` followed by a digit (e.g. `$5`) is not a shell variable, so allow it.
    if (ch === "$" && /[A-Za-z_{(]/.test(next)) {
      return "shell variable/command expansion ($…) is not supported by shell-execute";
    }
    // Backtick command substitution.
    if (ch === "`") {
      return "backtick command substitution is not supported by shell-execute";
    }
    // Process substitution <(…) / >(…) — only meaningful outside quotes.
    if ((ch === "<" || ch === ">") && next === "(" && !inDouble) {
      return "process substitution <(...)/>(...) is not supported by shell-execute";
    }
    // Backgrounding `&` — mid-string or trailing — escapes the timeout and the
    // segment/allow-list splitter (e.g. `sleep 100 & evil`). `&&` chaining is fine.
    if (ch === "&" && !inDouble) {
      if (next === "&") {
        i++; // consume the second '&' of a legitimate && chain
        continue;
      }
      const prev = i > 0 ? command[i - 1] : "";
      if (prev !== "&") {
        return "background operator '&' is not supported by shell-execute (escapes the timeout)";
      }
    }
  }

  return null;
}

/** Strip a single matching pair of leading/trailing shell quotes and leading redirect operators. */
function unwrapToken(raw: string): string {
  let tok = raw.replace(/^[<>]+/, "");
  if (
    (tok.startsWith('"') && tok.length > 1) ||
    (tok.startsWith("'") && tok.length > 1)
  ) {
    tok = tok.slice(1);
  }
  if (tok.endsWith('"') || tok.endsWith("'")) {
    tok = tok.slice(0, -1);
  }
  return tok;
}

/** True if `resolved` is the sandbox directory itself or nested within it. */
function isWithinSandbox(resolved: string, sandboxDir: string): boolean {
  return resolved === sandboxDir || resolved.startsWith(sandboxDir + "/");
}

/**
 * Detect path tokens that reference locations outside the sandbox.
 *
 * Every whitespace-separated token is canonicalized uniformly — quotes and
 * redirect operators stripped, then absolute paths resolved and relative
 * traversal (`..`) resolved against the sandbox — and asserted to stay inside
 * `sandboxDir`. This replaces the previous case-by-case checks (which only
 * covered bare-absolute and redirect-target tokens and were defeated by a
 * leading quote or a bare relative `..`).
 *
 * Returns an error message if unsafe, or `null` if safe.
 */
function detectUnsafePaths(command: string, sandboxDir: string): string | null {
  // Tilde expansion → references $HOME
  if (/~\//.test(command) || /~"/.test(command) || command.trim() === "~") {
    return "Command references home directory via ~ — outside the sandbox";
  }

  for (const raw of command.split(/\s+/)) {
    const token = unwrapToken(raw);
    if (!token) continue;

    if (isAbsolute(token)) {
      if (!isWithinSandbox(resolve(token), sandboxDir)) {
        return `Absolute path "${token}" is outside the sandbox (${sandboxDir})`;
      }
    } else if (token.includes("..")) {
      if (!isWithinSandbox(resolve(sandboxDir, token), sandboxDir)) {
        return `Relative path "${token}" escapes outside the sandbox`;
      }
    }
  }

  return null;
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

const COMMAND_CAPABILITY_MAP: Readonly<Record<string, ReadonlyArray<string>>> = {
  github: ["gh"],
  web: ["curl"],
  javascript: ["node", "bun", "npm", "npx"],
  python: ["python", "python3"],
  archive: ["tar"],
  environment: ["env", "xargs"],
};

function resolveCommandAccess(config?: ShellCommandAccessConfig): ReadonlyArray<string> {
  if (!config) return [];
  const fromCapabilities = (config.capabilities ?? []).flatMap(
    (capability) => COMMAND_CAPABILITY_MAP[capability] ?? [],
  );
  const fromCommands = config.commands ?? [];
  return [...new Set([...fromCapabilities, ...fromCommands])];
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
export interface ShellExecuteConfig {
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

// ── Tool definition ───────────────────────────────────────────────────

export const shellExecuteTool: ToolDefinition = {
  name: "shell-execute",
  description:
    "Execute a shell command inside a sandboxed /tmp directory. " +
    "Only safe, non-destructive commands are allowed by default (git, ls, cat, grep, find, " +
    "echo, mkdir, cp, mv, wc, head, tail, sort, jq, sed, awk, and common Unix text tools). " +
    "Runtime interpreters (node, python, curl) require explicit opt-in via additionalCommands. " +
    "Destructive commands (rm, sudo, chmod, chown, kill, mkfs) are always blocked. " +
    "All execution is confined to a temporary sandbox under /tmp — no access to " +
    "system directories, home directories, or sensitive paths. " +
    "Returns { executed, output, exitCode, stderr, truncated }.",
  parameters: [
    {
      name: "command",
      type: "string",
      description:
        "The shell command to execute. Must start with an allowed command prefix. " +
        "No shell expansion ($(), backticks), no piping to interpreters (| sh), " +
        "no access to paths outside the sandbox. " +
        "Examples: 'git log --oneline -5', 'ls -la', 'cat README.md'.",
      required: true,
    },
  ],
  returnType:
    "{ executed: true, output: string, stderr: string, exitCode: number, truncated: boolean, fullOutput?: string, fullStderr?: string } | " +
    "{ executed: false, error: string }",
  category: "system",
  riskLevel: "high",
  timeoutMs: 30_000,
  requiresApproval: true,
  source: "builtin",
  // CAN write files via redirects / commands — file producer (audit 01-F1 / C2).
  produces: "file",
};

// ── Handler factory ───────────────────────────────────────────────────

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
 */
export function shellExecuteHandler(
  config?: ShellExecuteConfig,
): (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError> {
  const maxOutputChars = config?.maxOutputChars ?? 4000;
  const timeoutMs = config?.timeoutMs ?? 30_000;
  const baseCommands = config?.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS;
  const additional = [
    ...(config?.additionalCommands ?? []),
    ...resolveCommandAccess(config?.commandAccess),
  ];
  const allowedCommands = [...baseCommands, ...additional];
  const resolvedCommandDirs = resolveCommandDirectories(additional);
  const executionPath = [
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    ...resolvedCommandDirs,
  ].join(":");
  // When the caller overrides `blockedPatterns`, we have raw regexes with no
  // labels — fall back to generic refusal messages. When unset, use the
  // labelled rule table so error messages name which policy fired.
  const blockedRules: ReadonlyArray<BlockedCommandRule> = config?.blockedPatterns
    ? config.blockedPatterns.map((pattern) => ({
        pattern,
        reason: "matches custom blocklist pattern",
      }))
    : DEFAULT_BLOCKED_RULES;
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
    (config?.sandbox ??
      (process.env.RA_SANDBOX === "docker" ? "docker" : "host")) === "docker";
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
      try: async () => {
        // ── 0. Validate input type ──
        if (typeof args.command !== "string" || !args.command.trim()) {
          return {
            executed: false,
            error: "Command must be a non-empty string",
          };
        }

        // ── 0b. Validate sandbox dir resolved ──
        if (!sandboxDir) {
          return {
            executed: false,
            error: "Working directory is outside the sandbox (/tmp). Set allowUnsafeCwd to override.",
          };
        }

        // ── 1. Sanitize ──
        const command = sanitizeCommand(args.command as string);
        if (!command) {
          audit({ command: args.command as string, allowed: false, reason: "sanitization-empty" });
          return {
            executed: false,
            error: "Command is empty after sanitization (too long or only control characters)",
          };
        }

        // ── 2. Allow-list check ──
        const disallowed = findDisallowedCommand(command, allowedCommands);
        if (disallowed !== null) {
          audit({ command, allowed: false, reason: "not-in-allowlist" });
          const firstWord = command.split(/\s+/)[0] ?? "";
          // Hint when the offender is opt-in (e.g. xargs/curl/node): tells the
          // caller the command exists in the framework but must be granted.
          const optInHint = OPT_IN_COMMANDS.includes(disallowed)
            ? ` ("${disallowed}" is opt-in — add it to additionalCommands to grant access)`
            : "";
          const segmentNote =
            disallowed && disallowed !== firstWord
              ? ` (in pipeline segment "${disallowed}")`
              : "";
          return {
            executed: false,
            error: `Command "${disallowed || firstWord}" is not in the allowed commands list${segmentNote}${optInHint}`,
          };
        }

        // ── 3. Block-list check ──
        const blockedReason = findBlockedReason(command, blockedRules);
        if (blockedReason !== null) {
          audit({ command, allowed: false, reason: "blocked-pattern" });
          return {
            executed: false,
            error: `Command blocked by security policy: ${blockedReason}`,
          };
        }

        // ── 3b. Shell expansion / substitution check ──
        const expansionIssue = detectShellExpansion(command);
        if (expansionIssue !== null) {
          audit({ command, allowed: false, reason: "shell-expansion" });
          return {
            executed: false,
            error: `Command blocked by security policy: ${expansionIssue}`,
          };
        }

        // ── 4. Path safety check ──
        const pathIssue = detectUnsafePaths(command, sandboxDir);
        if (pathIssue) {
          audit({ command, allowed: false, reason: "unsafe-path" });
          return {
            executed: false,
            error: `${pathIssue} — outside the sandbox`,
          };
        }

        // ── 4a. Opt-in Docker sandbox (F1b) ──
        // The command passed every input filter above; now run it inside a
        // hardened, throwaway container. Fails closed if Docker is unavailable.
        if (shellDockerSandbox) {
          audit({ command, allowed: true, reason: "docker-sandbox" });
          const dockerResult = await Effect.runPromise(
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
            const dockerResult = await Effect.runPromise(
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
            // Docker failed — fall through to host process execution
            audit({ command, allowed: true, reason: "docker-escalation-fallback" });
          }
        }

        // ── 5. Ensure sandbox directory exists ──
        if (!existsSync(sandboxDir)) {
          mkdirSync(sandboxDir, { recursive: true, mode: 0o700 });
        }

        // ── 6. Execute via Bun.spawn ──
        // Build a minimal environment. HOME always points at the sandbox so
        // that shell variable expansion ($HOME, ~) cannot escape to the real
        // home directory.  Only explicit token env vars are forwarded — never
        // HOME, XDG dirs, or any other path that could let the subprocess read
        // real user files.
        //
        // For authenticated CLIs (gh, stripe, etc.) that store credentials
        // under $HOME/.config/<app>, we resolve the real config path once here
        // and inject it as the vendor-specific override variable (GH_CONFIG_DIR).
        // This gives the CLI access to its own credential store without
        // exposing $HOME to shell expansion.
        const inheritedEnv: Record<string, string> = {};

        // Pass auth tokens directly — these are scalars with no path-traversal risk.
        for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"] as const) {
          const val = process.env[key];
          if (val !== undefined) inheritedEnv[key] = val;
        }

        // Resolve the real gh config dir and inject it as GH_CONFIG_DIR so the
        // CLI can read stored credentials while HOME stays confined to the sandbox.
        if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
          const realGhConfigDir =
            process.env.GH_CONFIG_DIR ??
            (process.env.XDG_CONFIG_HOME ? `${process.env.XDG_CONFIG_HOME}/gh` : null) ??
            (process.env.HOME ? `${process.env.HOME}/.config/gh` : null);
          if (realGhConfigDir) {
            inheritedEnv["GH_CONFIG_DIR"] = realGhConfigDir;
          }
        }

        const proc = spawn(["sh", "-c", command], {
          stdout: "pipe",
          stderr: "pipe",
          cwd: sandboxDir,
          env: {
            PATH: executionPath,
            // HOME stays confined to the sandbox — never the real home dir.
            HOME: sandboxDir,
            TMPDIR: sandboxDir,
            LANG: "C.UTF-8",
            ...inheritedEnv,
          },
        });

        // ── 7. Timeout ──
        const timeoutId = setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // Process may already have exited
          }
        }, timeoutMs);

        const stdoutText = await new Response(proc.stdout).text();
        const stderrText = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        clearTimeout(timeoutId);

        // ── 8. Truncation (stdout + stderr) ──
        const fullOutput = stdoutText;
        const fullStderr = stderrText;

        let output = fullOutput;
        let truncated = false;
        if (output.length > maxOutputChars) {
          output = output.slice(0, maxOutputChars);
          truncated = true;
        }

        let stderr = fullStderr;
        let stderrTruncated = false;
        if (stderr.length > maxOutputChars) {
          stderr = stderr.slice(0, maxOutputChars);
          stderrTruncated = true;
        }

        // ── 9. Audit log ──
        audit({ command, allowed: true, exitCode });

        return {
          executed: true,
          output,
          ...(truncated ? { fullOutput } : {}),
          stderr,
          ...(stderrTruncated ? { fullStderr } : {}),
          exitCode,
          truncated,
          stderrTruncated,
        };
      },
      catch: (e) =>
        new ToolExecutionError({
          message: `Shell execution failed: ${e instanceof Error ? e.message : String(e)}`,
          toolName: "shell-execute",
          cause: e,
        }),
    });
}
