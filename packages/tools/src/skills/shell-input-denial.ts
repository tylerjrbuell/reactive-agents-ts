/**
 * shell-execute input policy: the deterministic checks that decide whether a
 * command is refused BEFORE anything runs.
 *
 * One owner for both callers. `shellExecuteHandler` runs {@link checkShellInput}
 * at execution time; the tool's `preflight` (see `ToolDefinition.preflight`)
 * runs the same function so the framework can return the identical refusal
 * without first asking a human to approve a call that is guaranteed to fail.
 *
 * Leaf module: imports only other leaf shell modules, never `shell-execution.ts`
 * (type-only import aside), so the definition module can use it at load time.
 */
import { isAbsolute, resolve } from "node:path";

import type { BlockedCommandRule } from "./shell-execution.js";
import { DEFAULT_ALLOWED_COMMANDS, OPT_IN_COMMANDS } from "./shell-command-catalog.js";
import {
  isRedirectAmpersand,
  pathCandidateTokens,
  splitCommandSegments,
  withoutNullRedirects,
} from "./shell-command-segments.js";
import { scriptEscapeDenial } from "./shell-program-guard.js";
import { readOnlyGitDenial } from "./shell-git-readonly.js";

/** Maximum command length to prevent abuse via enormous strings. */
const MAX_COMMAND_LENGTH = 4096;

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
    // splitter (`sleep 100 & evil`). `&&` chaining is fine, and so is an `&` inside a
    // redirect (`2>&1`, `>&2`, `&>f`, `|&`): see isRedirectAmpersand.
    if (ch === "&" && !inDouble) {
      if (next === "&") {
        i++; // consume the second '&' of a legitimate && chain
        continue;
      }
      if (!isRedirectAmpersand(command, i)) {
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

  for (const raw of pathCandidateTokens(command)) {
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

/** The resolved policy {@link checkShellInput} enforces. */
export interface ShellInputPolicy {
  /** Every executable the tool may run (base list plus grants). */
  readonly allowedCommands: ReadonlyArray<string>;
  /** Labelled block-list rules (default table, or the caller's patterns). */
  readonly blockedRules: ReadonlyArray<BlockedCommandRule>;
  /** True when `blockedRules` came from a caller-supplied pattern list (sees the raw command). */
  readonly customBlocklist: boolean;
  /** Read-only git/gh preset on. */
  readonly gitReadOnly: boolean;
  /** Commands the read-only preset lets through after a human approves. */
  readonly approvalCommands?: ReadonlyArray<string>;
}

/** Outcome of {@link checkShellInput}. */
export type ShellInputVerdict =
  | { readonly denied: false; readonly command: string }
  | {
      readonly denied: true;
      /** The exact text the model sees as the refusal. */
      readonly error: string;
      /** Audit record for the attempt; absent when the handler audits nothing for this denial. */
      readonly audit?: { readonly command: string; readonly reason: string };
    };

/**
 * Run every deterministic input check, in execution order, and return the first
 * refusal. Pure: no I/O, no audit callback.
 *
 * `sandboxDir`: a string is the resolved working directory (cwd-dependent checks
 * run); `null` means the configured directory is unusable (a refusal); `undefined`
 * means the directory is not known yet (preflight), so the path-confinement check
 * is skipped and a refusal whose text names the directory (`cd`) is not decided.
 */
export function checkShellInput(
  args: Record<string, unknown>,
  policy: ShellInputPolicy,
  sandboxDir: string | null | undefined,
): ShellInputVerdict {
  const deny = (error: string, audit?: { command: string; reason: string }): ShellInputVerdict => ({
    denied: true,
    error,
    ...(audit ? { audit } : {}),
  });

  // ── 0. Validate input type ──
  if (typeof args.command !== "string" || !args.command.trim()) {
    return deny("Command must be a non-empty string");
  }

  // ── 0b. Validate sandbox dir resolved ──
  if (sandboxDir === null) {
    return deny("Working directory is outside the sandbox (/tmp). Set allowUnsafeCwd to override.");
  }

  // ── 1. Sanitize ──
  const command = sanitizeCommand(args.command);
  if (!command) {
    return deny("Command is empty after sanitization (too long or only control characters)", {
      command: args.command,
      reason: "sanitization-empty",
    });
  }
  const refuse = (reason: string, error: string): ShellInputVerdict => deny(error, { command, reason });

  // ── 2. Allow-list check ──
  const disallowed = findDisallowedCommand(command, policy.allowedCommands);
  if (disallowed !== null) {
    const firstWord = command.split(/\s+/)[0] ?? "";
    const offender = disallowed || firstWord;
    // `cd` can never work: each call is a fresh `sh -c` with cwd fixed at
    // the sandbox root — name the truth instead of a dead-end denial.
    if (offender === "cd") {
      if (sandboxDir === undefined) return { denied: false, command };
      return refuse(
        "not-in-allowlist",
        `cd does not persist between calls — the shell already starts in the sandbox root ${sandboxDir}; use paths relative to it`,
      );
    }
    // Hint when the offender is opt-in (e.g. xargs/curl/node): tells the
    // caller the command exists in the framework but must be granted.
    const optInHint = OPT_IN_COMMANDS.includes(offender)
      ? ` ("${offender}" is opt-in — add it to additionalCommands to grant access)`
      : "";
    const segmentNote =
      disallowed && disallowed !== firstWord ? ` (in pipeline segment "${disallowed}")` : "";
    // Neither allowlisted nor opt-in-grantable: name what IS available
    // so the model self-redirects. Skipped when optInHint fired.
    const redirectHint = optInHint
      ? ""
      : ` Allowed commands: ${policy.allowedCommands.join(", ")}.` +
        ` Commands requiring developer opt-in: ${OPT_IN_COMMANDS.join(", ")}`;
    return refuse(
      "not-in-allowlist",
      `Command "${offender}" is not in the allowed commands list${segmentNote}${optInHint}${redirectHint}`,
    );
  }

  // ── 3. Block-list check (default rules skip redirects to exactly /dev/null; custom patterns see the raw command) ──
  const scanned = policy.customBlocklist ? command : withoutNullRedirects(command);
  const blocked = policy.blockedRules.find((rule) => rule.pattern.test(scanned));
  if (blocked) {
    return refuse("blocked-pattern", `Command blocked by security policy: ${blocked.reason}`);
  }

  // ── 3b. Shell expansion / substitution check ──
  const expansionIssue = detectShellExpansion(command);
  if (expansionIssue !== null) {
    return refuse("shell-expansion", `Command blocked by security policy: ${expansionIssue}`);
  }

  // ── 3d. sed/awk programs: deny-by-default parse (always on; a boundary, not a policy) ──
  const scriptDenial = scriptEscapeDenial(command, policy.allowedCommands);
  if (scriptDenial !== null) {
    return refuse("script-escape", `Command blocked by security policy: ${scriptDenial}`);
  }

  // ── 3c. Read-only git/gh preset: allow-list of subcommands ──
  const gitDenial = policy.gitReadOnly ? readOnlyGitDenial(command, policy.approvalCommands) : null;
  if (gitDenial !== null) {
    return refuse("git-read-only", `Command blocked by security policy: ${gitDenial}`);
  }

  // ── 4. Path safety check (needs the resolved working directory) ──
  if (sandboxDir !== undefined) {
    const pathIssue = detectUnsafePaths(withoutNullRedirects(command), sandboxDir);
    if (pathIssue) return refuse("unsafe-path", `${pathIssue} — outside the sandbox`);
  }

  return { denied: false, command };
}
