import type { Command } from "../cli.ts"

/** Build the `help` command over a registry accessor (avoids a circular value import). */
export function makeHelp(list: () => readonly Command[]): Command {
  return {
    name: "help",
    summary: "List repo CLI commands",
    example: "bun run repo help",
    async run(_args, io) {
      const rows = list()
        .filter((c) => !c.hidden)
        .map((c) => ({ name: c.name, summary: c.summary, example: c.example }))
        .sort((a, b) => a.name.localeCompare(b.name))
      io.data(rows)
      const width = Math.max(...rows.map((r) => r.name.length))
      for (const r of rows) io.out(`${r.name.padEnd(width)}  ${r.summary}`)
      io.out("")
      io.out("Every command supports --json and --help.")
      return 0
    },
  }
}
