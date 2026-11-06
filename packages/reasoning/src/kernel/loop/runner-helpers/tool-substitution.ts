/**
 * runner-helpers/tool-substitution.ts — can tool B stand in for failed tool A?
 *
 * Truthfulness audit 2026-11-06, item 2: the recovery steer said "file-read
 * failed. Try an alternate path now: file-write" (56 runs). The "alternate"
 * could be whichever tool had not failed yet, substitute or not. Seen: file-read→file-write,
 * file-write→code-execute, web-search→file-read, code-execute→file-read.
 *
 * A substitute does the same KIND of work on the same KIND of target. Both are
 * read off the tool name, deterministic and pure:
 *  - mode: read (read/search/fetch/list…), write (write/edit/send…), execute;
 *  - domain: web, file, or the name's first non-mode token ("jira-search" and
 *    "jira-get" share domain "jira"). Execute tools share one domain.
 * A name with no recognizable mode has no class, so it never substitutes and
 * is never named as an alternate. The steer then asks for corrected arguments
 * on the failed tool instead. Under-naming is the safe direction.
 */

type ToolMode = "read" | "write" | "execute";

/** Work kind + target kind. Two tools substitute iff both fields match. */
export interface ToolClass {
  readonly mode: ToolMode;
  readonly domain: string;
}

const MODE_WORDS: Readonly<Record<ToolMode, ReadonlySet<string>>> = {
  read: new Set([
    "read", "get", "fetch", "search", "find", "list", "query", "lookup", "grep",
    "browse", "scrape", "crawl", "load", "download", "cat", "view", "glob",
  ]),
  write: new Set([
    "write", "edit", "create", "save", "append", "put", "post", "send", "update",
    "delete", "remove", "patch", "upload", "insert",
  ]),
  execute: new Set(["execute", "exec", "run", "shell", "eval"]),
};

const WEB_WORDS: ReadonlySet<string> = new Set([
  "web", "http", "https", "url", "browse", "scrape", "crawl", "fetch", "download",
]);
const FILE_WORDS: ReadonlySet<string> = new Set([
  "file", "files", "dir", "directory", "fs", "grep", "glob", "path", "cat", "folder",
]);

function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** The tool's class, or undefined when its name carries no recognizable mode. */
export function toolClassOf(name: string): ToolClass | undefined {
  const tokens = nameTokens(name);
  const modes = Object.keys(MODE_WORDS) as ToolMode[];
  const mode = tokens
    .map((t) => modes.find((m) => MODE_WORDS[m].has(t)))
    .find((m): m is ToolMode => m !== undefined);
  if (mode === undefined) return undefined;
  if (mode === "execute") return { mode, domain: "execute" };
  if (tokens.some((t) => WEB_WORDS.has(t))) return { mode, domain: "web" };
  if (tokens.some((t) => FILE_WORDS.has(t))) return { mode, domain: "file" };
  const head = tokens.find((t) => !MODE_WORDS[mode].has(t));
  return head === undefined ? undefined : { mode, domain: head };
}

/** True when `candidate` does the same kind of work on the same kind of target as `failed`. */
export function canSubstitute(failed: string, candidate: string): boolean {
  const a = toolClassOf(failed);
  const b = toolClassOf(candidate);
  return a !== undefined && b !== undefined && a.mode === b.mode && a.domain === b.domain;
}
