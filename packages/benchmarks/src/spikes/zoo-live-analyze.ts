// File: src/spikes/zoo-live-analyze.ts — per task x arm table from a bench:drive outDir.
//   bun run src/spikes/zoo-live-analyze.ts <outDir> <baseArm> [arm,arm,...]
// Prints n, solved, mean accuracy, mean iterations, mean billed tokens, tokens per solved run,
// causeLabel histogram, and b/c discordant run counts vs the base arm (same run index = back-to-back).
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

interface Cell {
  readonly taskId: string
  readonly run: number
  readonly accuracy: number | null
  readonly solved: boolean
  readonly iterations: number
  readonly billedTokens?: number
  readonly tokens: number
  readonly causeLabel: string
  readonly status: string
  readonly endStatus?: string
}
const [dir, base, armsArg] = process.argv.slice(2)
if (!dir || !base) {
  console.error("usage: <outDir> <baseArm> [arms]")
  process.exit(2)
}
const load = (arm: string): readonly Cell[] => {
  const p = join(dir, `${arm}.json`)
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { cells: Cell[] }).cells : []
}
const arms = armsArg ? armsArg.split(",") : ["off"]
const all = [base, ...arms.filter((a) => a !== base)]
const cells = Object.fromEntries(all.map((a) => [a, load(a)]))
const tasks = [...new Set(all.flatMap((a) => cells[a]!.map((c) => c.taskId)))]
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const tok = (c: Cell): number => c.billedTokens ?? c.tokens
console.log("task | arm | n | solved | acc | turns | tok/run | tok/solved | causes | b(base-only) c(arm-only)")
for (const t of tasks) {
  const baseCells = cells[base]!.filter((c) => c.taskId === t)
  for (const a of all) {
    const cs = cells[a]!.filter((c) => c.taskId === t)
    if (!cs.length) continue
    const solved = cs.filter((c) => c.solved)
    const causes: Record<string, number> = {}
    for (const c of cs) causes[c.causeLabel] = (causes[c.causeLabel] ?? 0) + 1
    let b = 0
    let cc = 0
    if (a !== base) {
      for (const c of cs) {
        const bc = baseCells.find((x) => x.run === c.run)
        if (!bc) continue
        if (bc.solved && !c.solved) b++
        if (!bc.solved && c.solved) cc++
      }
    }
    console.log(
      `${t} | ${a} | ${cs.length} | ${solved.length}/${cs.length} | ${mean(cs.map((c) => c.accuracy ?? 0)).toFixed(2)} | ${mean(cs.map((c) => c.iterations)).toFixed(1)} | ${mean(cs.map(tok)).toFixed(0)} | ${solved.length ? (cs.reduce((s, c) => s + tok(c), 0) / solved.length).toFixed(0) : "-"} | ${JSON.stringify(causes)} | ${a === base ? "-" : `b=${b} c=${cc}`}`,
    )
  }
}
