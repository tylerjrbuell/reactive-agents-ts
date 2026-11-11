/**
 * Git code-execution guard: block-list rules for git options that make git
 * run a program or load code chosen by the caller. Spread into
 * `DEFAULT_BLOCKED_RULES` (skills/shell-execution.ts), so both plain
 * `shell-execute` and the scoped `[git, gh]` shell refuse them.
 *
 * Rules test the whole command string, like every other block-list rule.
 * `gh` is matched too, because `gh repo clone <repo> -- <gitflags>` passes
 * flags through to `git clone`.
 */

/** One labelled block-list rule (structurally `BlockedCommandRule`). */
interface GitBlockedRule {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Regex source matching `--<option>` as a whole token, in every spelling git's
 * option parser accepts: full name or any unique abbreviation (git expands
 * `--up` to `--upload-pack`), optionally quoted, followed by `=`, a space,
 * a quote or the end. Prefixes go down to one letter because the shortest
 * unique abbreviation differs per subcommand (`clone --u`, `send-pack --r`).
 */
function longOption(name: string): string {
  const prefixes = Array.from({ length: name.length }, (_, i) => name.slice(0, name.length - i));
  return `\\b(?:git|gh)\\b.*\\s['"]?--(?:${prefixes.join("|")})(?=[\\s='"]|$)`;
}

/** Git rules of the default block-list. Order sets only the reported reason. */
export const GIT_BLOCKED_RULES: ReadonlyArray<GitBlockedRule> = [
  // git -c (spaced, glued, quoted) injects config that runs code; case-sensitive so -C <dir> passes
  { pattern: /\bgit\b.*\s['"]?-c(?:['"]?\s|\S*=)/, reason: "git -c is blocked (CWE-78 — config injection)" },
  // git clone --config — same vector via clone
  { pattern: /\bgit\b.*--config\b/i, reason: "git --config is blocked (CWE-78)" },
  // --upload-pack=<cmd> runs <cmd> on fetch/clone/pull/ls-remote
  { pattern: new RegExp(longOption("upload-pack")), reason: "git --upload-pack is blocked (CWE-78 — runs a command)" },
  // --receive-pack=<cmd> runs <cmd> on push/send-pack
  { pattern: new RegExp(longOption("receive-pack")), reason: "git --receive-pack is blocked (CWE-78 — runs a command)" },
  // --exec=<cmd> is the ls-remote/push/archive alias of the two above (also rebase --exec)
  { pattern: new RegExp(longOption("exec")), reason: "git --exec is blocked (CWE-78 — runs a command)" },
  // clone -u <cmd> is short for --upload-pack. Spaced, glued (-ucmd) or bundled after
  // clone's no-argument flags (-qu). Only clone: push -u (set-upstream) and fetch -u stay allowed.
  {
    pattern: /\b(?:git\b.*\sclone|gh\b.*\srepo\s+(?:clone|fork))(?=[\s'"]|$).*\s['"]?-[lsqvn]*u/,
    reason: "git clone -u is blocked (CWE-78 — short for --upload-pack, runs a command)",
  },
  // --exec-path=<dir> makes git run git-<subcommand> from <dir>; bare --exec-path only prints the path
  { pattern: /\bgit\b.*\s['"]?--exec-path=/, reason: "git --exec-path=<dir> is blocked (CWE-78 — loads programs from <dir>)" },
];
