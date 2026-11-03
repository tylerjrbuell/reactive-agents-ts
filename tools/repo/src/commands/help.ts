import type { Command } from "../cli.ts"
import { rejectUnknown } from "../lib/args.ts"
import { loadCatalog, SCRIPT_KINDS, type CatalogEntry } from "../lib/catalog.ts"
import { resolveRoot } from "../lib/root.ts"

/** Sibling CLIs, so agents pick the right tool. `repo` never replaces them. */
export const OTHER_TOOLS: readonly { name: string; useFor: string }[] = [
  { name: "rax", useFor: "use/operate agents (end-user CLI; never for repo checks)" },
  { name: "rax-diagnose", useFor: "explain a run trace: rax-diagnose cause <runId|path>" },
]

/** Entries shown per kind in the compact `help --all` view. */
const COMPACT_PER_KIND = 2

function byId(a: CatalogEntry, b: CatalogEntry): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Build the `help` command over a registry accessor (avoids a circular value import). */
export function makeHelp(list: () => readonly Command[]): Command {
  return {
    name: "help",
    summary: "List repo CLI commands; --all adds the script catalog",
    example: "bun run repo help --all",
    async run(args, io) {
      const bad = rejectUnknown(io, "help", args, { flags: ["--all"], values: ["--root"] })
      if (bad !== undefined) return bad
      const all = args.includes("--all")
      const rows = list()
        .filter((c) => !c.hidden)
        .map((c) => ({ name: c.name, summary: c.summary, example: c.example }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      const rootIdx = args.indexOf("--root")
      const catalog = all ? [...loadCatalog(resolveRoot(rootIdx >= 0 ? args[rootIdx + 1] : undefined))].sort(byId) : []
      io.data({ commands: rows, otherTools: OTHER_TOOLS, ...(all ? { catalog } : {}) })
      const width = Math.max(...rows.map((r) => r.name.length))
      for (const r of rows) io.result(`${r.name.padEnd(width)}  ${r.summary}`)
      if (all) {
        const idWidth = Math.max(...catalog.map((e) => e.id.length))
        for (const kind of SCRIPT_KINDS) {
          const group = catalog.filter((e) => e.kind === kind)
          io.out("")
          io.out(`${kind} (${group.length})`)
          const shown = io.full ? group : group.slice(0, COMPACT_PER_KIND)
          for (const e of shown) io.out(`  ${e.id.padEnd(idWidth)}  ${e.summary}`)
          if (shown.length < group.length) io.out(`  ... ${group.length - shown.length} more (use --full)`)
        }
      }
      io.result("")
      io.result("Every command supports --json, --full and --help.")
      io.result("Other tools:")
      const toolWidth = Math.max(...OTHER_TOOLS.map((t) => t.name.length))
      for (const t of OTHER_TOOLS) io.result(`  ${t.name.padEnd(toolWidth)}  ${t.useFor}`)
      return 0
    },
  }
}
