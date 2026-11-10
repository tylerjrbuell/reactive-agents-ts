// Scratch wrapper: run-h3 long-horizon with qwen3:14b registered. Arms differ only by RA_WRITE_COVERAGE (env).
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"
;(H3_TIERS as Record<string, (typeof H3_TIERS)[string]>)["qwen3:14b"] = { id: "qwen3:14b", provider: "ollama", model: "qwen3:14b", contextTier: "local" }
const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const r = await runH3({
  out: arg("out")!, traceRoot: arg("trace-root")!, tiers: arg("tier")!.split(","),
  k: Number(arg("k", "3")), budgetSec: Number(arg("budget-sec", "560")), cellTimeoutSec: Number(arg("cell-timeout-sec", "240")),
  ...(arg("start-margin-sec") ? { startMarginSec: Number(arg("start-margin-sec")) } : {}),
  suite: "long-horizon" as const, taskFilter: arg("task")!.split(","),
})
if (r.error) { console.error(r.error); process.exit(2) }
console.error(`[h3] ran=${r.ran} remaining=${r.remaining}`)
process.exit(0)
