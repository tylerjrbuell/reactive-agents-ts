import { execFileSync } from "node:child_process"

function git(root: string, args: readonly string[]): string[] {
  const out = execFileSync("git", [...args], { cwd: root, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return out.split("\n").filter((l) => l.length > 0)
}

/** Staged paths (added/copied/modified/renamed) from the index; honors `GIT_INDEX_FILE`. No untracked files. */
export function stagedFiles(root: string): readonly string[] {
  return git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).sort()
}

/** Union of `git diff --name-only HEAD` and untracked non-ignored files, sorted. */
export function changedFiles(root: string): readonly string[] {
  const set = new Set<string>([
    ...git(root, ["diff", "--name-only", "HEAD"]),
    ...git(root, ["ls-files", "--others", "--exclude-standard"]),
  ])
  return [...set].sort()
}
