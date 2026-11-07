// Scratch wrapper (not repo code): run-h3 long-horizon with qwen3:14b registered and,
// when SHELL=1, `shell-execute` added as an available tool on rw-7 and lh-debug-green.
// Tasks are mutated BEFORE runH3 computes the suite hash, so shell-arm results carry their own hash.
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"
import { LH_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/long-horizon-tasks.ts"
;(H3_TIERS as Record<string, (typeof H3_TIERS)[string]>)["qwen3:14b"] = { id: "qwen3:14b", provider: "ollama", model: "qwen3:14b", contextTier: "local" }
if (process.env.SHELL_ARM === "1") {
  for (const t of LH_TASKS) if (t.id === "rw-7" || t.id === "lh-debug-green") {
    ;(t as { tools: unknown }).tools = [...(t.tools ?? []), { kind: "available", name: "shell-execute" }]
  }
}
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
