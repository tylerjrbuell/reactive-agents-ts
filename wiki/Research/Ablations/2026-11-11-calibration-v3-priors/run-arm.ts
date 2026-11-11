// Frozen H3 suite, ONE arm per process (arm fixed by ./arm-plugin.ts via RA_ABL_CAL_DIR).
// Resumable: runH3 skips cells already in the results file, so the same command is
// re-issued (foreground, `timeout 590`) until `remaining=0`.
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_CAL_DIR=<dir> RA_ABL_ARM=<committed|candidate> \
//     bun --env-file=<repo>/.env --preload ./arm-plugin.ts run-arm.ts \
//     --tier qwen3:4b|cogito:8b --k <runs> --out-dir <abs> --task a,b [--cell-timeout-sec 200] [--budget-sec 560]
import { runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const arm = process.env.RA_ABL_ARM
if (arm !== "committed" && arm !== "candidate") { console.error("RA_ABL_ARM must be committed|candidate"); process.exit(2) }
const tier = arg("tier")!
const outDir = arg("out-dir")!
const cellT = Number(arg("cell-timeout-sec", "200"))
const slug = tier.replace(/[^\w.-]/g, "_")
const r = await runH3({
  out: `${outDir}/${arm}-h3-${slug}.json`, traceRoot: `${outDir}/traces-${arm}`, tiers: [tier],
  k: Number(arg("k", "1")), budgetSec: Number(arg("budget-sec", "560")), cellTimeoutSec: cellT,
  startMarginSec: cellT + 5, taskFilter: (arg("task") as string).split(","),
})
if (r.error) { console.error(r.error); process.exit(2) }
console.error(`[h3arm] ${arm} ${tier} k=${arg("k", "1")} ran=${r.ran} remaining=${r.remaining}`)
process.exit(0)
