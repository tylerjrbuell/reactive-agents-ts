import { isAbsolute, relative, resolve } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { ALLOW_MINUTES, recordAllow } from "../lib/allow-paths.ts"
import { loadPlacement, placeFile } from "../lib/placement.ts"
import { resolveRoot } from "../lib/root.ts"

/** Repo-relative form of `p`, or undefined when it lies outside `root`. */
function repoRelative(root: string, p: string): string | undefined {
  const rel = relative(root, isAbsolute(p) ? p : resolve(root, p))
  return rel.startsWith("..") || isAbsolute(rel) ? undefined : rel.split("\\").join("/")
}

/** `repo place <path>...` / `repo place --kind <word>`: where may a file live? */
export const placeCommand: Command = {
  name: "place",
  summary: "Check where a file may live, or where a kind of file goes",
  example: "bun run repo place wiki/Planning/Implementation-Plans/2026-11-03-x.md",
  detail: [
    "place <path>...      per path: ok, or the broken rule + canonical location",
    "place --kind <word>  canonical location for plan|spec|decision|debrief|experiment|failure-mode|test|script|skill",
    "place --allow <path> --reason \"<why>\"  let the Write hook create that exact path for 60 min (logged)",
    "Run before creating a file; the Write hook enforces the same rules.",
  ],
  async run(args, io) {
    const { positionals: paths, flagTokens } = splitArgs(args, ["--kind", "--root", "--allow", "--reason"])
    const bad = rejectUnknown(io, "place", flagTokens, { values: ["--kind", "--root", "--allow", "--reason"] })
    if (bad !== undefined) return bad
    const root = resolveRoot(flagValue(args, "--root"))
    const allow = flagValue(args, "--allow")
    if (allow !== undefined) {
      const reason = (flagValue(args, "--reason") ?? "").trim()
      const rel = repoRelative(root, allow)
      if (reason.length === 0) return io.usage("--allow needs --reason \"<why>\"", `bun run repo place --allow ${allow} --reason "<why>"`)
      if (rel === undefined) return io.usage("path is outside the repo; no allow needed", "bun run repo place --help")
      recordAllow(root, rel, reason)
      io.data({ allowed: rel, minutes: ALLOW_MINUTES })
      io.result(`allowed ${rel} for ${ALLOW_MINUTES} min (logged to .repo-logs/allow-paths.jsonl)`)
      return 0
    }
    const { rules } = loadPlacement(root)
    const kind = flagValue(args, "--kind")
    if (kind !== undefined) {
      const hits = rules.filter((r) => r.kind === kind)
      if (hits.length === 0)
        return io.usage(`unknown kind: ${kind} (known: ${[...new Set(rules.map((r) => r.kind))].join(", ")})`, "bun run repo place --help")
      io.data({ kind, canonical: hits.map((h) => ({ rule: h.id, canonical: h.canonical })) })
      for (const h of hits) io.result(`${h.kind}: ${h.canonical}  [${h.id}]`)
      return 0
    }
    if (paths.length === 0) return io.usage("no path given", "bun run repo place <path>... | --kind <word>")
    const results = paths.map((p) => {
      const rel = repoRelative(root, p)
      return { path: p, rel, verdict: rel === undefined ? ({ ok: true } as const) : placeFile(rel, rules) }
    })
    io.data({
      results: results.map((r) => ({ path: r.path, ...(r.verdict.ok ? { ok: true } : r.verdict) })),
    })
    let first: string | undefined
    for (const r of results) {
      if (r.verdict.ok) io.result(`ok ${r.path}`)
      else {
        io.result(`✗ ${r.verdict.ruleId}: ${r.verdict.reason} (${r.path})`)
        io.result(`canonical: ${r.verdict.canonical}`)
        first ??= r.verdict.canonical
      }
    }
    const n = results.filter((r) => !r.verdict.ok).length
    return first === undefined ? 0 : io.fail(`${n} path${n === 1 ? "" : "s"} misplaced`, `Write the file at ${first}`)
  },
}
