// Frozen H3 suite, ONE arm per process (arm fixed by ./arm-plugin.ts via RA_ABL_ARM on|off).
// Adapted from ../2026-11-10-family-disclosure-compact-facts/run-h3-arm.ts. Adds:
//   --max-iter N   budget-tight variant: overrides task.maxIterations in memory for the
//                  filtered tasks (H3 prompts, fixtures and graders unchanged). Results go
//                  to <arm>-h3mi<N>-<tier>.json; to-session.ts tags the task id @mi<N>.
//   grok-4 tier    xai, static-table (as in ../2026-11-10-stable-tool-list/run-h3-stl.ts).
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=<arm> bun --preload ./arm-plugin.ts run-h3-arm.ts \
//     --tier mimo-v2.6@16384|grok-4 --run <r> --out-dir <abs> --task a,b --max-iter 4 [--cell-timeout-sec 200]
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"
import { H3_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/tasks.ts"
import { ReactiveAgentBuilder } from "@reactive-agents/runtime"
import { primeCapability } from "@reactive-agents/llm-provider"

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const arm = process.env.RA_ABL_ARM ?? "on"
const tier = arg("tier")!
const [base, ctx] = tier.split("@")
const T = H3_TIERS as Record<string, (typeof H3_TIERS)[string]>
if (base === "mimo-v2.6" || base === "cogito:8b") {
  T[tier] = { id: tier, provider: "ollama", model: base, contextTier: "local" }
  await primeCapability("ollama", base)
  if (ctx) {
    const numCtx = Number(ctx)
    const proto = ReactiveAgentBuilder.prototype as unknown as { withModel: (m: unknown) => unknown }
    const orig = proto.withModel
    proto.withModel = function (this: unknown, m: unknown) {
      return orig.call(this, m === base ? { model: base, numCtx } : m)
    }
  }
} else if (tier === "grok-4") {
  T[tier] = { id: tier, provider: "xai", model: "grok-4", contextTier: "frontier" }
} else { console.error(`unsupported tier ${tier}`); process.exit(2) }

const outDir = arg("out-dir")!
const run = Number(arg("run", "0"))
const cellT = Number(arg("cell-timeout-sec", "200"))
const tasks = (arg("task") as string).split(",")
const maxIter = arg("max-iter") ? Number(arg("max-iter")) : undefined
if (maxIter !== undefined) for (const t of H3_TASKS) if (tasks.includes(t.id)) (t as { maxIterations?: number }).maxIterations = maxIter
const slug = tier.replace(/[^\w.-]/g, "_")
const suiteTag = maxIter !== undefined ? `h3mi${maxIter}` : "h3"
const r = await runH3({
  out: `${outDir}/${arm}-${suiteTag}-${slug}.json`, traceRoot: `${outDir}/traces-${arm}-${suiteTag}`, tiers: [tier],
  k: run + 1, budgetSec: cellT * tasks.length + 60, cellTimeoutSec: cellT, startMarginSec: cellT + 5, taskFilter: tasks,
})
if (r.error) { console.error(r.error); process.exit(2) }
console.error(`[h3arm] ${arm} ${suiteTag} run=${run} ran=${r.ran} remaining=${r.remaining}`)
process.exit(0)
