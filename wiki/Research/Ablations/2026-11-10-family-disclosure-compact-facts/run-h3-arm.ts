// Frozen H3 suite, ONE arm per process (arm fixed by ./arm-plugin.ts via RA_ABL_ARM).
// Adapted from ../2026-11-10-stable-tool-list/run-h3-stl.ts: registers mimo-v2.6@<numCtx>
// (capability primed via /api/show; explicit num_ctx through .withModel({ model, numCtx })).
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_ARM=<arm> bun --preload ./arm-plugin.ts run-h3-arm.ts \
//     --tier mimo-v2.6@16384 --run <r> --out-dir <abs> --task h3-required-tools [--cell-timeout-sec 200]
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"
import { ReactiveAgentBuilder } from "@reactive-agents/runtime"
import { primeCapability } from "@reactive-agents/llm-provider"

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const arm = process.env.RA_ABL_ARM ?? "base"
const tier = arg("tier")!
const [base, ctx] = tier.split("@")
const T = H3_TIERS as Record<string, (typeof H3_TIERS)[string]>
if (base !== "mimo-v2.6") { console.error(`unsupported tier ${tier}`); process.exit(2) }
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
const outDir = arg("out-dir")!
const run = Number(arg("run", "0"))
const cellT = Number(arg("cell-timeout-sec", "200"))
const tasks = (arg("task", "h3-required-tools") as string).split(",")
const slug = tier.replace(/[^\w.-]/g, "_")
const r = await runH3({
  out: `${outDir}/${arm}-h3-${slug}.json`, traceRoot: `${outDir}/traces-${arm}-h3`, tiers: [tier],
  k: run + 1, budgetSec: cellT + 30, cellTimeoutSec: cellT, startMarginSec: cellT + 5, taskFilter: tasks,
})
if (r.error) { console.error(r.error); process.exit(2) }
console.error(`[h3arm] ${arm} run=${run} ran=${r.ran}`)
process.exit(0)
