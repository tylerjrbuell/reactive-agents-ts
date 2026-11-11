// Gate-input normalisation (the only two edits made to measured rows; both are applied to BOTH arms):
//  1. run-wide.ts writes a wall-clock cut as status "timeout", inconclusive:false. The H3 runner marks the
//     same event inconclusive:true. Align to H3: a timeout is inconclusive (not a measured 0).
//  2. mimo-v2.6 rw-3 ran once per arm and was then dropped from the plan (plan-execute, 10k-token thinking
//     calls, 200 s cut, zero tool-surface events in every run of either tier: the mechanism cannot act there).
//     A 1-run cell would make the whole gate `underpowered`, so mimo rw-3 is excluded from the gate input.
//   bun prep.ts <outDir> <results.json>...   (writes <outDir>/<same file name>)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
const [outDir, ...files] = process.argv.slice(2)
mkdirSync(outDir!, { recursive: true })
for (const f of files) {
  const r = JSON.parse(readFileSync(f, "utf8")) as { cells: Array<Record<string, unknown>> }
  const before = r.cells.length
  r.cells = r.cells
    .filter((c) => !(String(c.tier).startsWith("mimo-v2.6") && c.taskId === "rw-3"))
    .map((c) => (c.status === "timeout" ? { ...c, inconclusive: true } : c))
  writeFileSync(`${outDir}/${f.split("/").pop()}`, JSON.stringify(r, null, 2))
  console.log(`${f.split("/").pop()}: ${before} -> ${r.cells.length} cells`)
}
