// Scratch wrapper: frozen H3 suite, arms interleaved per (run, task) in ONE process
// (same build): base = shipped default, stl = RA_STABLE_TOOL_LIST=1 (env, read at
// harness resolve time). Registers two tiers the H3 table does not carry:
//   mimo-v2.6@<numCtx>  ollama, capability primed via /api/show (else the bench voids it
//                       as fallback), explicit num_ctx through .withModel({ model, numCtx })
//   grok-4              xai, static-table
//   bun run-h3-stl.ts --tier mimo-v2.6@16384|grok-4 --k 3 --out-dir <abs> [--task a,b] [--budget-sec 560] [--cell-timeout-sec 240]
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"
import { H3_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/tasks.ts"
import { ReactiveAgentBuilder } from "@reactive-agents/runtime"
import { primeCapability } from "@reactive-agents/llm-provider"

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const tier = arg("tier")!
const [base, ctx] = tier.split("@")
const T = H3_TIERS as Record<string, (typeof H3_TIERS)[string]>
if (base === "mimo-v2.6") {
  T[tier] = { id: tier, provider: "ollama", model: "mimo-v2.6", contextTier: "local" }
  await primeCapability("ollama", "mimo-v2.6")
  if (ctx) {
    const numCtx = Number(ctx)
    const proto = ReactiveAgentBuilder.prototype as unknown as { withModel: (m: unknown) => unknown }
    const orig = proto.withModel
    proto.withModel = function (this: unknown, m: unknown) {
      return orig.call(this, m === "mimo-v2.6" ? { model: "mimo-v2.6", numCtx } : m)
    }
  }
} else if (tier === "grok-4") {
  T[tier] = { id: tier, provider: "xai", model: "grok-4", contextTier: "frontier" }
} else { console.error(`unknown tier ${tier}`); process.exit(2) }

const outDir = arg("out-dir")!
const k = Number(arg("k", "3"))
const budgetSec = Number(arg("budget-sec", "560"))
const cellT = Number(arg("cell-timeout-sec", "240"))
const tasks = arg("task") ? arg("task")!.split(",") : H3_TASKS.map((t) => t.id)
const slug = tier.replace(/[^\w.-]/g, "_")
const started = Date.now()
let ran = 0
outer: for (let run = 0; run < k; run++) for (const task of tasks) for (const arm of ["base", "stl"]) {
  const left = budgetSec - (Date.now() - started) / 1000
  if (left < cellT + 10) break outer
  if (arm === "stl") process.env.RA_STABLE_TOOL_LIST = "1"; else delete process.env.RA_STABLE_TOOL_LIST
  const r = await runH3({
    out: `${outDir}/${arm}-h3-${slug}.json`, traceRoot: `${outDir}/traces-${arm}-h3`, tiers: [tier],
    k: run + 1, budgetSec: left, cellTimeoutSec: cellT, startMarginSec: cellT + 5, taskFilter: [task],
  })
  if (r.error) { console.error(r.error); process.exit(2) }
  ran += r.ran
}
delete process.env.RA_STABLE_TOOL_LIST
console.error(`[h3stl] ran=${ran} elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`)
process.exit(0)
