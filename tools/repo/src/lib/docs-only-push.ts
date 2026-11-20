#!/usr/bin/env bun
/**
 * Docs-only skip for the pre-push CI mirror (owner-approved 2026-11-19, v0.19.0 retro items 3, 5, 6).
 *
 * A commit skips the mirror only when an ancestor already passed a full `repo ci` (recorded in
 * `.repo-logs/ci-verified.jsonl`) and every path changed after it is a docs path: `wiki/**`,
 * `.agents/**` or a `*.md` file at the repo root. The paths are the union of each commit's own
 * files and the net diff from the verified ancestor, with rename detection off, so a code file
 * moved into `wiki/` still counts as a code change. No verified ancestor, or any other path, means
 * the mirror runs. Tag pushes never reach this check (the hook decides that).
 *
 * Run (from `.githooks/pre-push`): `bun tools/repo/src/lib/docs-only-push.ts <sha>`
 * Prints one line. Exit 0: skip the mirror. Exit 1: run it. Any other exit: the hook runs it.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Ancestors searched for a mirror-verified commit. */
export const ANCESTOR_LIMIT = 500

/** True for a path the docs-only skip ignores: `wiki/**`, `.agents/**`, or a root-level `*.md`. */
export function isDocsPath(path: string): boolean {
  if (path.startsWith("wiki/") || path.startsWith(".agents/")) return true
  return !path.includes("/") && path.toLowerCase().endsWith(".md")
}

/** First of `ancestors` (newest first, the commit itself included) found in `verified`. */
export function nearestVerified(ancestors: readonly string[], verified: ReadonlySet<string>): string | undefined {
  return ancestors.find((a) => verified.has(a))
}

/** The skip decision. */
export type DocsSkip =
  | { readonly skip: true; readonly base: string; readonly files: number }
  | { readonly skip: false; readonly reason: string }

/** Decide from the verified ancestor (undefined when none) and the paths changed after it. */
export function decideDocsSkip(base: string | undefined, changed: readonly string[]): DocsSkip {
  if (base === undefined) return { skip: false, reason: "no mirror-verified ancestor" }
  const code = changed.find((p) => !isDocsPath(p))
  if (code !== undefined) return { skip: false, reason: `code path changed since ${base.slice(0, 9)}: ${code}` }
  return { skip: true, base, files: changed.length }
}

/** SHAs in a `ci-verified.jsonl` text. Bad lines are ignored. */
export function parseVerified(text: string): Set<string> {
  const out = new Set<string>()
  for (const line of text.split("\n")) {
    const m = /"sha":"([0-9a-f]{40})"/.exec(line)
    if (m?.[1] !== undefined) out.add(m[1])
  }
  return out
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

const lines = (s: string): string[] => s.split("\n").filter((l) => l.length > 0)

/** Decision for `sha` in the repo at `root`, reading `verifiedLog` (path relative to `root`). */
export function docsSkipFor(root: string, sha: string, verifiedLog = ".repo-logs/ci-verified.jsonl"): DocsSkip {
  let text = ""
  try {
    text = readFileSync(join(root, verifiedLog), "utf8")
  } catch {
    // No log: nothing verified.
  }
  const base = nearestVerified(lines(git(root, ["rev-list", `--max-count=${ANCESTOR_LIMIT}`, sha])), parseVerified(text))
  if (base === undefined || base === sha) return decideDocsSkip(base, [])
  const perCommit = lines(git(root, ["log", "--no-renames", "--format=", "--name-only", `${base}..${sha}`]))
  const net = lines(git(root, ["diff", "--no-renames", "--name-only", base, sha]))
  return decideDocsSkip(base, [...new Set([...perCommit, ...net])])
}

if (import.meta.main) {
  const sha = process.argv[2]
  if (sha === undefined) {
    console.error("usage: bun tools/repo/src/lib/docs-only-push.ts <sha>")
    process.exit(2)
  }
  const d = docsSkipFor(process.cwd(), sha)
  console.log(d.skip ? `docs-only since mirror-verified ${d.base.slice(0, 9)} (${d.files} file(s) under wiki/, .agents/ or root *.md)` : d.reason)
  process.exit(d.skip ? 0 : 1)
}
