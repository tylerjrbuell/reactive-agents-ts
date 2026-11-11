// Move execution-timeout cells (inconclusive, status error, cause aborted) out of a
// results file into results/voided-cells.json so runH3's resume re-runs them. A timed-out
// cell says nothing about the arm; the gate needs >= 3 MEASURED runs per paired cell.
//   bun void-timeouts.ts <results.json>...
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

type Cell = { cellId: string; inconclusive: boolean; error?: string }
const voidPath = join(import.meta.dir, "results/voided-cells.json")
const voided: Array<{ file: string; cell: Cell }> = existsSync(voidPath) ? JSON.parse(readFileSync(voidPath, "utf8")) : []
for (const f of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(f, "utf8")) as { cells: Cell[] }
  const out = r.cells.filter((c) => c.inconclusive && c.error === "execution-timeout")
  if (out.length === 0) continue
  for (const c of out) { voided.push({ file: f.split("/").pop()!, cell: c }); console.log(`voided ${f.split("/").pop()} ${c.cellId}`) }
  writeFileSync(f, JSON.stringify({ ...r, cells: r.cells.filter((c) => !out.includes(c)) }, null, 2))
}
writeFileSync(voidPath, JSON.stringify(voided, null, 2))
