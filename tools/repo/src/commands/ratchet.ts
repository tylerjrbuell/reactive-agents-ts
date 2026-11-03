import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { loadChecks } from "../lib/manifest.ts"
import { applyTightening, evaluateRatchets, isViolation } from "../lib/ratchet.ts"
import { resolveRoot } from "../lib/root.ts"

/** `repo ratchet`: show (or with --write apply) ceilings that can shrink. Never raises one. */
export const ratchetCommand: Command = {
  name: "ratchet",
  summary: "Show ceilings that can tighten; --write applies them",
  example: "bun run repo ratchet --write",
  async run(args, io) {
    const bad = rejectUnknown(io, "ratchet", args, { flags: ["--write"], values: ["--root"] })
    if (bad !== undefined) return bad
    const root = resolveRoot(flagValue(args, "--root"))
    const rows = evaluateRatchets(root, loadChecks(root))
    const label = (r: (typeof rows)[number]): string => `${r.id} ${r.file}${r.key === undefined ? "" : ` [${r.key}]`}`
    io.data(rows)
    for (const r of rows.filter((x) => x.old !== undefined && x.measured < x.old)) io.out(`${label(r)}: ${r.old} → ${r.measured}`)
    const over = rows.filter(isViolation)
    if (args.includes("--write")) applyTightening(root, rows)
    if (over.length > 0) {
      for (const r of over)
        io.out(
          r.old === undefined
            ? `${label(r)}: unpinned (measured ${r.measured}, no ceiling in file)`
            : `${label(r)}: measured ${r.measured} exceeds ceiling ${r.old} (over by ${r.measured - r.old})`,
        )
      return io.fail(`${over.length} ceiling(s) exceeded`, "bun run repo check --only " + (over[0] as (typeof rows)[number]).id)
    }
    return 0
  },
}
