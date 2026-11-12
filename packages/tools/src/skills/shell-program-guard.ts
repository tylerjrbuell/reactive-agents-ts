/**
 * Script-interpreter guard for `shell-execute`: `sed` and `awk` take a small
 * PROGRAM as an argument, and both languages can run commands and write files
 * from inside it (`sed e`, `sed 'w/path'`, `s///e`, `awk system()`, `awk
 * 'print | "cmd"'`). A regex block-list cannot be the boundary for that, since
 * each spelling it misses is a host command execution. This module parses the
 * program instead and is DENY-BY-DEFAULT: a construct it does not recognise as
 * safe is refused.
 *
 * - sed: an allow-list of commands (`s`, `y`, `p`, `d`, `n`, branching, ...);
 *   `e`, `w`, `W`, `r`, `R` commands, the `e` / `w` flags of `s`, and `-f`
 *   script files are refused.
 * - awk: `system`, `getline`, `ARGV`, any `|`, `@` directives, output
 *   redirects (`>`, `>>`) inside `print` / `printf`, and `-f` / `-i` / `-l`
 *   are refused. A `>` that is a comparison (`$3 > 5`) stays allowed.
 *
 * Leaf module apart from the segment helpers. Wired in as step 3d of
 * `shellExecuteHandler` (skills/shell-execution.ts); runs regardless of a
 * caller-supplied `blockedPatterns`, because it is a boundary, not a policy.
 */
import { DEFAULT_ALLOWED_COMMANDS } from "./shell-command-catalog.js";
import { shellWords, splitCommandSegments } from "./shell-command-segments.js";

/** One labelled block-list rule (structurally `BlockedCommandRule`). */
interface ScriptBlockedRule {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Legacy regex rules for the interpreter escapes, kept in the default
 * block-list for their specific error text. They are NOT the boundary;
 * {@link scriptEscapeDenial} is.
 */
export const SCRIPT_BLOCKED_RULES: ReadonlyArray<ScriptBlockedRule> = [
  { pattern: /\bawk\b.*\bsystem\s*\(/i, reason: "awk system() enables shell injection" },
  { pattern: /\bawk\b.*\bgetline\b/i, reason: "awk getline (arbitrary file/command read) is blocked" },
  { pattern: /\bawk\b.*\|\s*"/i, reason: "awk print-pipe to a command is blocked (shell injection)" },
  { pattern: /\bsed\b.*\/e\b/i, reason: "sed /e flag enables shell injection" },
  // sort spawns --compress-program (and abbreviations `--com…`) to compress temp files
  { pattern: /\bsort\b.*\s['"]?--co/, reason: "sort --compress-program runs a command (CWE-78)" },
];

/** Commands that run another command; a sed/awk after one is still analysed. */
const WRAPPERS: ReadonlySet<string> = new Set([
  "xargs", "env", "timeout", "nice", "nohup", "time", "command", "exec", "stdbuf", "ionice", "setsid",
]);

const base = (word: string): string => word.slice(word.lastIndexOf("/") + 1);

/**
 * Refusal message when any pipeline segment of `command` runs `sed` or `awk`
 * with a program that can execute commands or write files; `null` otherwise.
 * Expects the already-sanitized command string.
 */
export function scriptEscapeDenial(
  command: string,
  allowedCommands: ReadonlyArray<string> = DEFAULT_ALLOWED_COMMANDS,
): string | null {
  for (const segment of splitCommandSegments(command)) {
    // Redirect words (`> out`, `2>&1`) are not arguments of the program.
    const words = shellWords(segment).filter((w) => !/^[0-9&]*[<>]/.test(w));
    let at = 0;
    while (at < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at]!)) at++; // VAR=val prefix
    const first = words[at];
    if (first === undefined) continue;
    if (base(first) === "find") {
      const denial = findDenial(words.slice(at + 1), allowedCommands);
      if (denial !== null) return denial;
      continue;
    }
    let start = at;
    if (WRAPPERS.has(base(first))) {
      // `xargs -I {} sed …`, `env X=1 awk …`, `timeout 5 sed …`: find the program anywhere after.
      start = words.findIndex((w, i) => i > at && (base(w) === "sed" || base(w) === "awk"));
      if (start === -1) continue;
    }
    const name = base(words[start]!);
    const args = words.slice(start + 1);
    if (name === "sed") {
      const denial = sedDenial(args);
      if (denial !== null) return denial;
    } else if (name === "awk") {
      const denial = awkDenial(args);
      if (denial !== null) return denial;
    }
  }
  return null;
}

// ── find ──────────────────────────────────────────────────────────────

const FIND_WRITE_ACTIONS: ReadonlySet<string> = new Set(["-fprint", "-fprint0", "-fprintf", "-fls"]);
const FIND_EXEC_ACTIONS: ReadonlySet<string> = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * `find` writes files with `-fprint*` / `-fls` and runs programs with
 * `-exec*` / `-ok*`. Write actions are refused; the program of an exec action
 * must itself be allow-listed, not a wrapper, and (for sed/awk) pass its own
 * program check.
 */
function findDenial(args: ReadonlyArray<string>, allowedCommands: ReadonlyArray<string>): string | null {
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!;
    if (FIND_WRITE_ACTIONS.has(arg)) return `find ${arg} (writes a file) is blocked`;
    if (!FIND_EXEC_ACTIONS.has(arg)) continue;
    const sub: string[] = [];
    for (k++; k < args.length; k++) {
      const w = args[k]!;
      if (w === ";" || w === "\\" || w === "\\;" || (w === "+" && args[k - 1] === "{}")) break;
      sub.push(w);
    }
    const program = sub[0];
    if (program === undefined) continue;
    const name = base(program);
    if (!allowedCommands.includes(name) || WRAPPERS.has(name) || name === "find") {
      return `find ${arg} of '${name}' (program not allowed there) is blocked`;
    }
    const denial = name === "sed" ? sedDenial(sub.slice(1)) : name === "awk" ? awkDenial(sub.slice(1)) : null;
    if (denial !== null) return denial;
  }
  return null;
}

// ── sed ───────────────────────────────────────────────────────────────

function sedDenial(args: ReadonlyArray<string>): string | null {
  const scripts: string[] = [];
  const positional: string[] = [];
  let endOfOptions = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!;
    if (endOfOptions || !arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg : arg.slice(0, eq);
      const inline = eq === -1 ? undefined : arg.slice(eq + 1);
      if (name.length >= 3 && "--expression".startsWith(name)) scripts.push(inline ?? args[++k] ?? "");
      else if (name.length >= 3 && "--file".startsWith(name)) return "sed -f/--file (script from a file) is blocked";
      else if (name.length >= 3 && "--line-length".startsWith(name) && inline === undefined) k++;
      continue;
    }
    for (let c = 1; c < arg.length; c++) {
      const flag = arg[c]!;
      if (flag === "f") return "sed -f/--file (script from a file) is blocked";
      if (flag === "e") {
        scripts.push(arg.slice(c + 1) || (args[++k] ?? ""));
        break;
      }
      if (flag === "l") {
        if (c === arg.length - 1) k++; // `-l N`: the length is the next word, not the script
        break;
      }
      if (flag === "i") break; // `-i[SUFFIX]`: the rest of the word is the suffix
    }
  }
  if (scripts.length === 0) {
    const script = positional.shift();
    if (script === undefined) return null;
    scripts.push(script);
  }
  return sedScriptDenial(scripts.join("\n"));
}

/** Parse a sed script; refuse anything that is not provably free of command execution and file access. */
function sedScriptDenial(script: string): string | null {
  const n = script.length;
  let i = 0;
  const unparseable = "sed script could not be verified safe and is blocked";
  const skipBlanks = (): void => {
    while (i < n && /[ \t]/.test(script[i]!)) i++;
  };
  /** Consume through the closing `delim`, honouring backslash escapes. */
  const readDelimited = (delim: string): boolean => {
    while (i < n) {
      const ch = script[i++]!;
      if (ch === "\\") i++;
      else if (ch === delim) return true;
    }
    return false;
  };
  /** Consume one address; false when none starts here, `null` when malformed. */
  const readAddress = (): boolean | null => {
    const ch = script[i];
    if (ch === undefined) return false;
    if (/\d/.test(ch)) {
      while (i < n && /\d/.test(script[i]!)) i++;
      if (script[i] === "~") {
        i++;
        while (i < n && /\d/.test(script[i]!)) i++;
      }
      return true;
    }
    if (ch === "$") {
      i++;
      return true;
    }
    if (ch === "/" || ch === "\\") {
      let delim = "/";
      i++;
      if (ch === "\\") {
        delim = script[i] ?? "";
        if (delim === "" || delim === "\n" || delim === "\\") return null;
        i++;
      }
      if (!readDelimited(delim)) return null;
      while (i < n && (script[i] === "I" || script[i] === "M")) i++;
      return true;
    }
    return false;
  };

  for (;;) {
    while (i < n && /[\s;{}]/.test(script[i]!)) i++;
    if (i >= n) return null;
    const first = readAddress();
    if (first === null) return unparseable;
    if (first) {
      skipBlanks();
      if (script[i] === ",") {
        i++;
        skipBlanks();
        if (script[i] === "+" || script[i] === "~") {
          i++;
          while (i < n && /\d/.test(script[i]!)) i++;
        } else if (readAddress() !== true) return unparseable;
      }
    }
    skipBlanks();
    while (script[i] === "!") {
      i++;
      skipBlanks();
    }
    if (i >= n) return null;
    const cmd = script[i++]!;
    switch (cmd) {
      case "#":
        while (i < n && script[i] !== "\n") i++;
        break;
      case "s": {
        const delim = script[i++];
        if (delim === undefined || /[\s\\]/.test(delim)) return unparseable;
        if (!readDelimited(delim) || !readDelimited(delim)) return unparseable;
        while (i < n && !/[\s;}#]/.test(script[i]!)) {
          const flag = script[i++]!;
          if (flag === "e") return "sed s///e flag (runs the result as a command) is blocked";
          if (flag === "w") return "sed s///w flag (writes a file) is blocked";
          if (!/[0-9gpiImM]/.test(flag)) return unparseable;
        }
        break;
      }
      case "y": {
        const delim = script[i++];
        if (delim === undefined || /[\s\\]/.test(delim)) return unparseable;
        if (!readDelimited(delim) || !readDelimited(delim)) return unparseable;
        break;
      }
      case "a":
      case "i":
      case "c": // text runs to the end of the line
        while (i < n && script[i] !== "\n") i++;
        break;
      case ":":
      case "b":
      case "t":
      case "T":
      case "v": // label / version: ends at `;`, blank or `}`
        skipBlanks();
        while (i < n && !/[\s;}]/.test(script[i]!)) i++;
        break;
      case "l":
      case "L":
      case "q":
      case "Q":
        skipBlanks();
        while (i < n && /\d/.test(script[i]!)) i++;
        break;
      case "e":
        return "sed e command (runs a shell command) is blocked";
      case "w":
      case "W":
        return "sed w/W command (writes a file) is blocked";
      case "r":
      case "R":
        return "sed r/R command (reads a file) is blocked";
      case "{":
      case "}":
      case "=":
      case "d":
      case "D":
      case "g":
      case "G":
      case "h":
      case "H":
      case "n":
      case "N":
      case "p":
      case "P":
      case "x":
      case "z":
      case "F":
        break;
      default:
        return unparseable;
    }
  }
}

// ── awk ───────────────────────────────────────────────────────────────

const AWK_SAFE_LONG_OPTIONS: ReadonlySet<string> = new Set([
  "--version", "--help", "--posix", "--traditional", "--csv", "--re-interval",
  "--characters-as-bytes", "--use-lc-numeric", "--sandbox",
]);

function awkDenial(args: ReadonlyArray<string>): string | null {
  const programs: string[] = [];
  const positional: string[] = [];
  let endOfOptions = false;
  for (let k = 0; k < args.length; k++) {
    const arg = args[k]!;
    if (endOfOptions || !arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const name = arg.split("=")[0]!;
      if (AWK_SAFE_LONG_OPTIONS.has(name)) continue;
      if ((name === "--field-separator" || name === "--assign") && arg.includes("=")) continue;
      return `awk option ${name} is blocked (loads code or files)`;
    }
    for (let c = 1; c < arg.length; c++) {
      const flag = arg[c]!;
      if (flag === "F" || flag === "v") {
        if (c === arg.length - 1) k++; // value is the next word
        break;
      }
      if (flag === "e") {
        programs.push(arg.slice(c + 1) || (args[++k] ?? ""));
        break;
      }
      if ("filEW".includes(flag)) return `awk -${flag} (loads a program, extension or file) is blocked`;
    }
  }
  if (programs.length === 0) {
    const program = positional.shift();
    if (program === undefined) return null;
    programs.push(program);
  }
  for (const program of programs) {
    const denial = awkProgramDenial(program);
    if (denial !== null) return denial;
  }
  return null;
}

/** `/` begins a regex (not a division) when the previous significant char is one of these. */
const REGEX_CAN_FOLLOW = "{(,;!~&|=<>?:*%^}";

/** Scan an awk program; refuse command execution, program-driven file access and output redirection. */
function awkProgramDenial(program: string): string | null {
  const n = program.length;
  let depth = 0;
  let printDepth = -1; // >= 0 while inside a print/printf statement
  let prev = "";
  for (let i = 0; i < n; i++) {
    const ch = program[i]!;
    if (/\s/.test(ch)) continue;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && program[i] !== '"') {
        if (program[i] === "\\") i++;
        i++;
      }
      prev = '"';
      continue;
    }
    if (ch === "#") {
      while (i < n && program[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && (prev === "" || REGEX_CAN_FOLLOW.includes(prev))) {
      i++;
      while (i < n && program[i] !== "/") {
        if (program[i] === "\\") i++;
        i++;
      }
      prev = ")";
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < n && /[A-Za-z0-9_]/.test(program[end]!)) end++;
      const ident = program.slice(i, end);
      i = end - 1;
      if (ident === "system") return "awk system() enables shell injection";
      if (ident === "getline") return "awk getline (arbitrary file/command read) is blocked";
      if (ident === "ARGV") return "awk ARGV (program-chosen input files) is blocked";
      if (ident === "print" || ident === "printf") printDepth = depth;
      prev = "a";
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === ";" || ch === "{" || ch === "}") printDepth = -1;
    else if (ch === "@") return "awk @ directives (include/load) are blocked";
    else if (ch === "|") {
      if (program[i + 1] === "|") i++; // logical OR
      else return "awk pipe (to or from a command) is blocked";
    } else if (ch === ">" && printDepth >= 0 && depth === printDepth) {
      return "awk output redirect (print > file) is blocked";
    }
    prev = ch;
  }
  return null;
}
