/**
 * Last commit per docs file for the "Last updated" line only. One `git log`
 * pass for the whole tree (not one subprocess per page). This is display
 * data; it never drives New/Updated markers (those are release-based, see
 * `indicators.ts`).
 */
import { execFileSync } from "node:child_process";
import { relative } from "node:path";

export interface LastCommit {
  readonly hash: string;
  readonly date: string;
}

const MARK = "\u0001";

/** Parse `git log --name-only --format=\u0001%h|%ad` output (newest first); first sighting wins. */
export function parseLastCommits(log: string): Map<string, LastCommit> {
  const out = new Map<string, LastCommit>();
  let current: LastCommit | null = null;
  for (const line of log.split("\n")) {
    if (line.startsWith(MARK)) {
      const [hash, date] = line.slice(1).split("|");
      current = hash && date ? { hash, date } : null;
    } else if (line && current && !out.has(line)) {
      out.set(line, current);
    }
  }
  return out;
}

let cache: { root: string; map: Map<string, LastCommit> } | null = null;

/** Map of repo-relative path to its last commit, for everything under `contentDir`. */
export function loadLastCommits(repoRoot: string, contentDir: string): Map<string, LastCommit> {
  if (cache?.root === repoRoot) return cache.map;
  let map = new Map<string, LastCommit>();
  try {
    const log = execFileSync(
      "git",
      ["log", `--format=${MARK}%h|%ad`, "--date=short", "--name-only", "--", relative(repoRoot, contentDir)],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    map = parseLastCommits(log);
  } catch {
    // No git (tarball build): the line is simply omitted.
  }
  cache = { root: repoRoot, map };
  return map;
}
