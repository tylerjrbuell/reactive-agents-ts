/**
 * Read-only allow-list for the scoped git/gh shell (`builtins: ["git"]`,
 * `gh-cli`, `git-cli`). That shell needs no approval, so it may only read.
 *
 * Why an allow-list: git runs code from many places a block-list cannot
 * enumerate. `git config core.fsmonitor '<cmd>'` and `git config alias.x
 * '!cmd'` store a command in `.git/config` that the next `git status` or
 * `git x` runs; hooks, `rebase -x`, `submodule foreach`, `bisect run`,
 * `difftool -x`, `grep -O` and `gh alias set --shell` / `gh extension` run
 * commands directly; an output redirect can overwrite `.git/config` or a
 * hook. So the preset names what it runs and refuses the rest. The
 * git block-list (skills/shell-git-guard.ts) still applies first, as defense
 * in depth.
 *
 * Enabled by `ShellExecuteConfig.gitReadOnly` (set by `scopedShellConfig`);
 * the full terminal does not set it and keeps its approval gate. The host
 * environment adds the other half (skills/shell-git-env.ts): no system
 * config, hooks off, fsmonitor off, and a global config with only the
 * user's name and email.
 */
import { hasOutputRedirect, shellWords, splitCommandSegments, withoutNullRedirects } from "./shell-command-segments.js";
import { segmentMatchesCommandRules } from "./shell-command-rules.js";

/**
 * git subcommands the read-only preset runs. They read the repository;
 * `fetch` also updates remote-tracking refs. `branch` and `tag` run only in
 * list mode, `remote` only bare / `show` / `get-url`, `stash` only `list` /
 * `show`. Aliases are not on the list, so a user's `!` alias never runs.
 */
export const GIT_READ_ONLY_SUBCOMMANDS: readonly string[] = [
  "status", "log", "diff", "show", "blame", "shortlog", "grep", "describe",
  "rev-parse", "rev-list", "ls-files", "ls-tree", "ls-remote", "cat-file",
  "show-ref", "for-each-ref", "show-branch", "merge-base", "name-rev",
  "count-objects", "check-ignore", "version", "fetch", "branch", "tag",
  "remote", "stash",
];

/**
 * gh commands the read-only preset runs: command group to allowed actions.
 * `gh api` is allowed for GET requests only; `gh --version`, `gh version`,
 * `gh help` and `gh status` also run. `--web` / `-w` is refused everywhere.
 */
export const GH_READ_ONLY_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  repo: ["view", "list"],
  pr: ["view", "list", "status", "diff", "checks"],
  issue: ["view", "list", "status"],
  release: ["view", "list"],
  run: ["view", "list"],
  workflow: ["view", "list"],
  search: ["repos", "issues", "prs", "commits", "code"],
  label: ["list"],
  gist: ["view", "list"],
};

/** git options allowed before the subcommand. `-C` takes the next word. */
const GIT_GLOBAL_FLAGS = ["--no-pager", "-P", "--no-optional-locks"];

const GH_TOP_LEVEL = ["--version", "version", "--help", "help", "status"];

const HINT =
  'Commands that change the repository or run code need the full terminal, ' +
  '.withTools({ terminal: true, builtins: ["git"] }), which asks for approval.';

const deny = (what: string, why: string): string =>
  `${what} is not allowed in the read-only git/gh shell: ${why}. ${HINT}`;

/**
 * True when `word` is `--<name>` or an abbreviation of it, with or without
 * `=value`. git's option parser expands unique abbreviations (`--out=x` is
 * `--output=x`), so every prefix counts.
 */
function isLongOption(word: string, name: string): boolean {
  if (!word.startsWith("--") || word === "--") return false;
  const opt = word.slice(2).split("=")[0]!;
  return opt.length > 0 && name.startsWith(opt);
}

/** True when `word` is a short-option cluster (`-vD`) containing one of `chars`. */
const shortCluster = (word: string, chars: string): boolean =>
  /^-[^-]/.test(word) && [...word.slice(1)].some((c) => chars.includes(c));

/** Flag table for a subcommand that lists without arguments and writes with them. */
interface ListModeSpec {
  readonly writeShort: string;
  readonly writeLong: readonly string[];
  readonly listShort: string;
  readonly listLong: readonly string[];
  /** Long options whose value may be the next word. */
  readonly valueLong: readonly string[];
}

const LIST_VALUE_FLAGS = ["contains", "no-contains", "merged", "no-merged", "points-at", "sort", "format"];
const LIST_TRIGGERS = ["list", "contains", "no-contains", "merged", "no-merged", "points-at"];

const BRANCH_SPEC: ListModeSpec = {
  writeShort: "dDmMcCfut",
  writeLong: [
    "delete", "move", "copy", "force", "set-upstream-to", "unset-upstream",
    "edit-description", "track", "no-track", "create-reflog", "recurse-submodules",
  ],
  listShort: "lar",
  listLong: [...LIST_TRIGGERS, "all", "remotes", "show-current"],
  valueLong: LIST_VALUE_FLAGS,
};

const TAG_SPEC: ListModeSpec = {
  writeShort: "asufdvmFe",
  writeLong: [
    "annotate", "sign", "local-user", "force", "delete", "verify", "message",
    "file", "edit", "cleanup", "create-reflog", "trailer",
  ],
  listShort: "l",
  listLong: LIST_TRIGGERS,
  valueLong: LIST_VALUE_FLAGS,
};

/**
 * `branch` / `tag`: refuse write flags, and refuse names unless a list flag
 * is present (a bare `git branch x` creates `x`).
 */
function listModeReason(sub: string, args: readonly string[], spec: ListModeSpec): string | null {
  let listMode = false;
  let positional = 0;
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (w === "--") {
      positional += args.length - i - 1;
      break;
    }
    if (w.startsWith("--")) {
      const name = w.slice(2).split("=")[0]!;
      if (spec.writeLong.some((n) => n.startsWith(name))) return deny(`git ${sub} ${w}`, "it changes refs");
      if (spec.listLong.includes(name)) listMode = true;
      if (spec.valueLong.includes(name) && !w.includes("=")) i++;
      continue;
    }
    if (w.startsWith("-") && w.length > 1) {
      if (shortCluster(w, spec.writeShort)) return deny(`git ${sub} ${w}`, "it changes refs");
      if (shortCluster(w, spec.listShort)) listMode = true;
      continue;
    }
    positional++;
  }
  if (positional > 0 && !listMode) {
    return deny(`git ${sub} <name>`, `it creates a ${sub}; use --list <pattern> to list`);
  }
  return null;
}

/** Reason the git invocation `args` (words after `git`) is not read-only, or `null`. */
function gitReason(args: readonly string[]): string | null {
  let i = 0;
  while (i < args.length) {
    if (args[i] === "-C") i += 2;
    else if (GIT_GLOBAL_FLAGS.includes(args[i]!)) i++;
    else break;
  }
  const sub = args[i];
  if (sub === undefined || sub === "--version") return null;
  if (sub.startsWith("-")) {
    return deny(`git option "${sub}"`, "only -C <dir>, --no-pager, -P and --no-optional-locks may precede the subcommand");
  }
  if (!GIT_READ_ONLY_SUBCOMMANDS.includes(sub)) {
    return deny(`git "${sub}"`, `it is not a read-only subcommand (allowed: ${GIT_READ_ONLY_SUBCOMMANDS.join(", ")})`);
  }
  const rest = args.slice(i + 1);
  if (rest.some((w) => isLongOption(w, "output"))) return deny(`git ${sub} --output`, "it writes a file");
  const first = rest.find((w) => !w.startsWith("-"));
  switch (sub) {
    case "grep":
      return rest.some((w) => isLongOption(w, "open-files-in-pager") || shortCluster(w, "O"))
        ? deny("git grep -O", "it runs a command")
        : null;
    case "branch":
      return listModeReason(sub, rest, BRANCH_SPEC);
    case "tag":
      return listModeReason(sub, rest, TAG_SPEC);
    case "remote":
      return first === undefined || first === "show" || first === "get-url"
        ? null
        : deny(`git remote ${first}`, "only `git remote [-v]`, `show` and `get-url` read");
    case "stash":
      return rest[0] === "list" || rest[0] === "show"
        ? null
        : deny(`git stash${rest[0] === undefined ? "" : ` ${rest[0]}`}`, "only `git stash list` and `git stash show` read");
    default:
      return null;
  }
}

/**
 * `gh api`: GET (or HEAD) only. A field (`-f`, `-F`, `--field`,
 * `--raw-field`, `--input`) without an explicit method makes gh send a POST.
 */
function ghApiReason(args: readonly string[]): string | null {
  const methods: string[] = [];
  let fields = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    if (w.startsWith("--")) {
      const eq = w.indexOf("=");
      const name = eq === -1 ? w.slice(2) : w.slice(2, eq);
      const value = eq === -1 ? undefined : w.slice(eq + 1);
      if (name === "method") methods.push(value ?? args[++i] ?? "");
      else if (name === "field" || name === "raw-field" || name === "input") fields = true;
      else if (["header", "jq", "template", "preview", "hostname", "cache"].includes(name) && value === undefined) i++;
      continue;
    }
    if (!/^-[^-]/.test(w)) continue;
    // pflag short cluster: bool flags, then at most one value flag, whose
    // value is the rest of the word or else the next word.
    const valueAt = [...w.slice(1)].findIndex((c) => "XfFHpqt".includes(c)) + 1;
    if (valueAt === 0) continue;
    const flag = w[valueAt]!;
    const inline = w.slice(valueAt + 1);
    const value = inline !== "" ? inline : args[++i] ?? "";
    if (flag === "X") methods.push(value);
    else if (flag === "f" || flag === "F") fields = true;
  }
  const nonGet = methods.find((m) => !/^(get|head)$/i.test(m));
  if (nonGet !== undefined) return deny(`gh api -X ${nonGet}`, "only GET requests read");
  if (fields && methods.length === 0) return deny("gh api with fields", "gh sends it as a POST; add -X GET to send fields as a query");
  return null;
}

/** Reason the gh invocation `args` (words after `gh`) is not read-only, or `null`. */
function ghReason(args: readonly string[]): string | null {
  const web = args.find((w) => w === "--web" || w === "-w");
  if (web !== undefined) return deny(`gh ${web}`, "it opens a browser");
  const group = args[0];
  if (group === undefined || GH_TOP_LEVEL.includes(group)) return null;
  if (group === "api") return ghApiReason(args.slice(1));
  const actions = Object.hasOwn(GH_READ_ONLY_COMMANDS, group) ? GH_READ_ONLY_COMMANDS[group] : undefined;
  if (actions === undefined) {
    return deny(`gh "${group}"`, `it is not a read-only command (allowed: api (GET), ${Object.keys(GH_READ_ONLY_COMMANDS).join(", ")})`);
  }
  const action = args[1];
  if (action === undefined || !actions.includes(action)) {
    return deny(`gh ${group} ${action ?? ""}`.trimEnd(), `only ${actions.map((a) => `gh ${group} ${a}`).join(", ")} read`);
  }
  return null;
}

/** The read-only git/gh fields of `ShellExecuteConfig` (skills/shell-execution.ts). */
export interface ShellGitReadOnlyConfig {
  /** git and gh run only read-only subcommands (skills/shell-git-readonly.ts); hooks, fsmonitor and system config off. Set by `scopedShellConfig`. */
  readonly gitReadOnly?: boolean;
  /**
   * Command rules (skills/shell-command-rules.ts) the read-only shell runs
   * after approval: a git/gh segment the read-only allow-list refuses runs
   * when it matches one, e.g. `["git push"]`. Output redirects stay refused,
   * except to exactly `/dev/null`.
   *
   * The shell does not ask for approval itself. Pass the same list to the
   * kernel approval gate (`shellCallMatchesCommandRules`), so a matched
   * command only reaches the shell after a human approved it.
   */
  readonly approvalCommands?: readonly string[];
}

/**
 * Why `command` is not allowed in the read-only git/gh shell, or `null` when
 * every git/gh segment only reads or matches one of `approvalCommands`.
 * Segments for other programs are left to the allow-list. Runs after
 * shell-execute's own checks (allow-list, block-list, expansion), so
 * `command` holds no `$`, backtick or background `&`.
 */
export function readOnlyGitDenial(command: string, approvalCommands: readonly string[] = []): string | null {
  // Discarding output (`2>/dev/null`) writes no file; every other target is refused.
  const checked = withoutNullRedirects(command);
  if (hasOutputRedirect(checked)) {
    return deny("An output redirect (>)", "it writes files, such as .git/config or a hook");
  }
  for (const segment of splitCommandSegments(checked.trim())) {
    const words = shellWords(segment);
    const program = words[0]?.split("/").pop();
    const reason =
      program === "git" ? gitReason(words.slice(1)) : program === "gh" ? ghReason(words.slice(1)) : null;
    if (reason !== null && !segmentMatchesCommandRules(segment, approvalCommands)) return reason;
  }
  return null;
}
