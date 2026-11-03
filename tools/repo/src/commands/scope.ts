import type { Command } from "../cli.ts"
import { rejectUnknown } from "../lib/args.ts"
import { changedFiles } from "../lib/changed-files.ts"
import { loadOwnership, scopeFiles } from "../lib/ownership.ts"
import { resolveRoot } from "../lib/root.ts"

/** `repo scope`: who owns, which gates guard, and which docs cover a set of files. */
export const scopeCommand: Command = {
  name: "scope",
  summary: "Owners, checks and docs for changed files (or the given files)",
  example: "bun run repo scope packages/reasoning/src/kernel/loop/runner.ts",
  async run(args, io) {
    // Positionals are files; everything else goes through the shared flag validator.
    const files: string[] = []
    const flagArgs: string[] = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as string
      if (a === "--root") flagArgs.push(a, args[++i] ?? "")
      else if (a.startsWith("-")) flagArgs.push(a)
      else files.push(a)
    }
    const bad = rejectUnknown(io, "scope", flagArgs, { values: ["--root"] })
    if (bad !== undefined) return bad
    const rootIdx = flagArgs.indexOf("--root")
    const root = resolveRoot(rootIdx >= 0 ? flagArgs[rootIdx + 1] : undefined)

    const targets = files.length > 0 ? files : changedFiles(root)
    if (targets.length === 0) {
      io.data({ files: [], owners: [], checks: [], docs: [], unowned: [], noOwner: [] })
      io.result("no changes")
      return 0
    }
    const r = scopeFiles(targets, loadOwnership(root))
    io.data({ files: targets, ...r })
    const block = (name: string, items: readonly string[]): void => {
      io.out(`${name}:`)
      if (items.length === 0) io.out("  (none)")
      for (const i of items) io.out(`  ${i}`)
    }
    block("owners", r.owners)
    block("checks", r.checks)
    block("docs", r.docs)
    if (r.noOwner.length > 0) block("no-owner", r.noOwner.map((n) => `${n.file} (reason: ${n.reason})`))
    if (r.unowned.length > 0) block("unowned", r.unowned)
    if (r.owners.length > 0)
      io.result(`next: dispatch ${r.owners.join(", ")} with a MissionBrief (.agents/skills/mission-brief/SKILL.md)`)
    return 0
  },
}
