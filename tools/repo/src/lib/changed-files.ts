import { execFileSync } from "node:child_process"

function git(root: string, args: readonly string[]): string[] {
  const out = execFileSync("git", [...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return out.split("\n").filter((l) => l.length > 0)
}

/** Union of `git diff --name-only HEAD` and untracked non-ignored files, sorted. */
export function changedFiles(root: string): readonly string[] {
  const set = new Set<string>([
    ...git(root, ["diff", "--name-only", "HEAD"]),
    ...git(root, ["ls-files", "--others", "--exclude-standard"]),
  ])
  return [...set].sort()
}
