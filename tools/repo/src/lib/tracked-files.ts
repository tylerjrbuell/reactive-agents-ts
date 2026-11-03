import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

function gitZ(root: string, args: readonly string[]): string[] {
  const out = execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  return out.split("\0").filter((p) => p.length > 0)
}

function walk(root: string, dir: string, out: string[]): void {
  for (const name of readdirSync(join(root, dir)).sort()) {
    if (name === ".git" || name === "node_modules") continue
    const rel = dir === "" ? name : `${dir}/${name}`
    if (statSync(join(root, rel)).isDirectory()) walk(root, rel, out)
    else out.push(rel)
  }
}

/**
 * Every file git knows about, plus untracked non-ignored files: the same universe as `git`, so
 * nothing is silently skipped the way the shell `grep` wrapper (ugrep `--ignore-files`) does.
 * Sorted; files deleted from the working tree are dropped. A root without `.git` is walked.
 */
export function trackedFiles(root: string): readonly string[] {
  if (!existsSync(join(root, ".git"))) {
    const out: string[] = []
    walk(root, "", out)
    return out
  }
  const all = new Set([...gitZ(root, ["ls-files", "-z"]), ...gitZ(root, ["ls-files", "-z", "--others", "--exclude-standard"])])
  return [...all].filter((p) => existsSync(join(root, p))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
