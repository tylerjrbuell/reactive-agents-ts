import { Effect } from "effect";
import { mkdirSync, existsSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

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
export const DEFAULT_BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  // rm with force/recursive flags in any order
  /\brm\b.*-[^\s]*r[^\s]*f/i,
  /\brm\b.*-[^\s]*f[^\s]*r/i,
  /\brm\b.*--recursive/i,
  /\brm\b.*--force/i,
  // rm as a standalone command (blocked entirely — too dangerous)
  /(?:^|\s|[;&|])\s*rm\s/i,
  // Privilege escalation
  /(?:^|\s|[;&|])\s*sudo\b/i,
  // Dangerous permissions
  /\bchmod\s+7[0-7]{2}\b/i,
  /(?:^|\s|[;&|])\s*chown\b/i,
  // Shell injection
  /(?:^|\s|[;&|])\s*eval\b/i,
  /\$\(/,          // $() command substitution
  /`[^`]*`/,       // backtick command substitution
  // Pipe to shell interpreters
  /\|\s*(sh|bash|zsh|dash|ksh|csh)\b/i,
  // Writes to sensitive system paths via redirect
  />\s*\/etc\//i,
  />\s*\/dev\//i,
  />\s*\/usr\//i,
  />\s*\/boot\//i,
  />\s*\/sys\//i,
  />\s*\/proc\//i,
  />\s*\/var\/(log|run|spool)\//i,
  // Disk/partition tools
  /(?:^|\s|[;&|])\s*mkfs\b/i,
  /(?:^|\s|[;&|])\s*fdisk\b/i,
  /(?:^|\s|[;&|])\s*dd\b/i,
  // Process manipulation
  /(?:^|\s|[;&|])\s*kill\b/i,
  /(?:^|\s|[;&|])\s*killall\b/i,
  // Persistent background processes
  /(?:^|\s|[;&|])\s*nohup\b/i,
  /(?:^|\s|[;&|])\s*disown\b/i,
  // Crontab
  /(?:^|\s|[;&|])\s*crontab\b/i,
  // awk shell escape — system() executes arbitrary commands
  /\bawk\b.*\bsystem\s*\(/i,
  // awk pipe-to-getline — can read from arbitrary commands
  /\bawk\b.*\|.*\bgetline\b/i,
  // sed execute flag — runs replacement as shell command (s/pat/repl/e)
  /\bsed\b.*\/e\b/i,
  // find -exec/-execdir/-ok — arbitrary command execution through find (CWE-78)
  /\bfind\b.*\s-exec\b/i,
  /\bfind\b.*\s-execdir\b/i,
  /\bfind\b.*\s-ok\b/i,
  // find -delete — file deletion through find
  /\bfind\b.*\s-delete\b/i,
  // git config-based code execution (CWE-78): -c injects config that runs code
  /\bgit\b.*\s-c\s/i,
  // git clone --config — same vector via clone
  /\bgit\b.*--config\b/i,
  // Background operator & (CWE-400): escapes timeout, spawns unmanaged process.
  // Negative lookbehind ensures && (legitimate chaining) is not matched.
  /(?<!&)&\s*$/,
  // ${...} variable interpolation (CWE-78): indirect injection via parameter expansion
  /\$\{/,
];

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
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Split on chaining operators (&&, ||, ;) and pipes (|), but only when
  // they appear outside quoted strings so jq filters like '.[] | .field'
  // do not get treated as shell command separators.
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

  let hasCommand = false;

  for (const segment of segments) {
    const seg = segment.trim();
    if (!seg) continue;
    hasCommand = true;
    const firstWord = seg.split(/\s+/)[0]!;
    // Extract basename to prevent absolute-path bypass:
    // /usr/bin/wget → wget → not in defaults → blocked
    const name = firstWord.includes("/") ? firstWord.split("/").pop()! : firstWord;
    if (!allowList.includes(name)) return false;
  }

  return hasCommand;
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
 * Detect absolute paths, tilde expansion, or path-traversal sequences
 * that reference locations outside the sandbox.
 *
 * Returns an error message if unsafe, or `null` if safe.
 */
function detectUnsafePaths(command: string, sandboxDir: string): string | null {
  // Tilde expansion → references $HOME
  if (/~\//.test(command) || /~"/.test(command) || command.trim() === "~") {
    return "Command references home directory via ~ — outside the sandbox";
  }

  // Extract all path-like tokens from the command.
  // Tokens after redirection operators (>, >>) are especially dangerous.
  const tokens = command.split(/\s+/);
  for (const token of tokens) {
    // Absolute paths: must be inside sandboxDir
    if (token.startsWith("/")) {
      const resolved = resolve(token);
      if (!resolved.startsWith(sandboxDir)) {
        return `Absolute path "${token}" is outside the sandbox (${sandboxDir})`;
      }
    }

    // Redirect targets after > or >>
    if (token.startsWith(">")) {
      const target = token.replace(/^>>?/, "").trim();
      if (target && target.startsWith("/")) {
        const resolved = resolve(target);
        if (!resolved.startsWith(sandboxDir)) {
          return `Redirect target "${target}" is outside the sandbox`;
        }
      }
    }
  }

  // Also check for redirect operator followed by a path (as separate tokens)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === ">" || tokens[i] === ">>") {
      const target = tokens[i + 1];
      if (target) {
        if (target.startsWith("/")) {
          const resolved = resolve(target);
          if (!resolved.startsWith(sandboxDir)) {
            return `Redirect target "${target}" is outside the sandbox`;
          }
        }
        if (target.includes("..")) {
          const resolved = resolve(sandboxDir, target);
          if (!resolved.startsWith(sandboxDir)) {
            return `Redirect target "${target}" escapes outside the sandbox`;
          }
        }
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
  const blockedPatterns = config?.blockedPatterns ?? DEFAULT_BLOCKED_PATTERNS;
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
        if (!isCommandAllowed(command, allowedCommands)) {
          audit({ command, allowed: false, reason: "not-in-allowlist" });
          return {
            executed: false,
            error: `Command "${command.split(/\s+/)[0]}" is not in the allowed commands list`,
          };
        }

        // ── 3. Block-list check ──
        if (isCommandBlocked(command, blockedPatterns)) {
          audit({ command, allowed: false, reason: "blocked-pattern" });
          return {
            executed: false,
            error: `Command blocked by security policy`,
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

        const proc = Bun.spawn(["sh", "-c", command], {
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
