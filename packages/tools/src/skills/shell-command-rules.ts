/**
 * Command-level approval rules for shell tools.
 *
 * A rule names a command by its leading words: `"git push"` matches
 * `git push origin main`, `"rm"` matches `rm -rf x`. The same rule list goes
 * to two places, so a command a rule matches only runs after a human
 * approved it:
 *
 * - the kernel approval gate asks {@link shellCallMatchesCommandRules}
 *   whether a tool call needs approval (deny by default);
 * - the read-only git/gh shell (`ShellExecuteConfig.approvalCommands`) runs a
 *   write command only when every segment it would refuse matches a rule.
 *
 * Pure functions, no Effect: both callers are synchronous predicates.
 */
import { shellWords, splitCommandSegments } from "./shell-command-segments.js";

/**
 * Tool names that run a shell command line from `args.command`:
 * `shell-execute` (the terminal and the scoped git/gh shell share this name)
 * and the removed `gh-cli` / `git-cli` wrapper names, which now resolve to it.
 */
export const SHELL_TOOL_NAMES: readonly string[] = ["shell-execute", "gh-cli", "git-cli"];

/** True when `toolName` runs a shell command line (see {@link SHELL_TOOL_NAMES}). */
export const isShellToolName = (toolName: string): boolean => SHELL_TOOL_NAMES.includes(toolName);

/** Leading words that run the rest of the segment as a command. */
const WRAPPERS = ["sudo", "env", "command", "exec", "nohup"];

const isAssignment = (word: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

/**
 * The words of one command segment as a rule sees them: leading `NAME=value`
 * assignments and bare wrapper words (`sudo`, `env`, ...) dropped, and the
 * program reduced to its base name (`/usr/bin/git` is `git`). A wrapper with
 * options (`sudo -u x git push`) is not unwrapped.
 */
export function commandWords(segment: string): string[] {
  const words = shellWords(segment);
  let i = 0;
  const bareWrapper = (j: number): boolean => WRAPPERS.includes(words[j]!) && !(words[j + 1] ?? "").startsWith("-");
  while (i < words.length && (isAssignment(words[i]!) || bareWrapper(i))) i++;
  const rest = words.slice(i);
  if (rest.length > 0) rest[0] = rest[0]!.split("/").pop()!;
  return rest;
}

/**
 * A rule as words. A trailing `*` (alone or on the last word) is dropped:
 * `"git push *"`, `"git push*"` and `"git push"` are the same rule. A rule
 * with no words (`""`, `"*"`) matches nothing.
 */
function ruleWords(rule: string): string[] {
  const words = shellWords(rule.trim());
  const last = words.length - 1;
  if (last >= 0 && words[last]!.endsWith("*")) {
    const stripped = words[last]!.slice(0, -1);
    if (stripped === "") words.pop();
    else words[last] = stripped;
  }
  return words;
}

/** Programs that run another program given as an argument. */
const RUNNER_PROGRAMS: ReadonlySet<string> = new Set([
  ...WRAPPERS, "xargs", "timeout", "nice", "time", "stdbuf", "ionice", "setsid",
]);

/** git global options that consume the next word (`-C dir`, `-c k=v`, ...). */
const GIT_VALUE_OPTIONS: ReadonlySet<string> = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--attr-source",
]);

/** `git -C dir --no-pager push` is `git push`: drop git's global options before the subcommand. */
function withoutGitGlobalOptions(words: string[]): string[] {
  if (words[0] !== "git") return words;
  let i = 1;
  while (i < words.length && words[i]!.startsWith("-")) i += GIT_VALUE_OPTIONS.has(words[i]!) ? 2 : 1;
  return ["git", ...words.slice(i)];
}

/**
 * The command starts a rule can match in one segment. Normally one. A runner
 * (`xargs`, `timeout 5`, `sudo -u x`, `env -i`) takes options we do not model,
 * so every later word is a candidate start (fail closed: more approvals, never
 * fewer). Each candidate has its program reduced to a base name and git's
 * global options removed.
 */
function commandCandidates(segment: string): string[][] {
  const words = commandWords(segment);
  if (words.length === 0) return [];
  const starts = RUNNER_PROGRAMS.has(words[0]!) ? words.map((_, i) => i) : [0];
  return starts.map((i) => {
    const rest = words.slice(i);
    rest[0] = rest[0]!.split("/").pop()!;
    return withoutGitGlobalOptions(rest);
  });
}

/** True when the words of `segment` start with the words of one of `rules`. */
export function segmentMatchesCommandRules(segment: string, rules: readonly string[]): boolean {
  const candidates = commandCandidates(segment);
  return rules.some((rule) => {
    const want = ruleWords(rule);
    return (
      want.length > 0 &&
      candidates.some((words) => want.length <= words.length && want.every((w, i) => words[i] === w))
    );
  });
}

/**
 * True when any segment of `command` (split on `&&`, `||`, `;`, `|` and
 * newlines, outside quotes) matches one of `rules`.
 */
export function commandMatchesRules(command: string, rules: readonly string[]): boolean {
  if (rules.length === 0) return false;
  return command
    .split(/[\r\n]+/)
    .some((line) => splitCommandSegments(line.trim()).some((s) => segmentMatchesCommandRules(s, rules)));
}

/**
 * True when a tool call runs a shell command that one of `rules` names:
 * `toolName` is a shell tool ({@link SHELL_TOOL_NAMES}), `args.command` is a
 * string, and any of its segments starts with a rule's words.
 *
 * @example
 * shellCallMatchesCommandRules("shell-execute", { command: "git status && git push" }, ["git push"]); // true
 * shellCallMatchesCommandRules("file-write", { command: "git push" }, ["git push"]); // false
 */
export function shellCallMatchesCommandRules(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  rules: readonly string[],
): boolean {
  const command = args["command"];
  return isShellToolName(toolName) && typeof command === "string" && commandMatchesRules(command, rules);
}
