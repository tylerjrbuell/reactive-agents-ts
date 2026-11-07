// Scratch wrapper (not repo code): run-h3 with extra Ollama tiers registered.
// H3_TIERS is a plain exported Record; this adds entries in-process, then runs
// the unmodified run-h3 CLI entry by delegating to runH3 with the same args.
//   bun run-h3-extra.ts <same args as run-h3.ts>
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"

const EXTRA = ["gemma4:e4b", "qwen3:14b", "llama3.2:3b"] as const
for (const m of EXTRA) (H3_TIERS as Record<string, (typeof H3_TIERS)[string]>)[m] = { id: m, provider: "ollama", model: m, contextTier: "local" }
// Paid leg (owner-approved scope change 2026-11-07, US$3 cap): one non-Anthropic cheap tier.
;(H3_TIERS as Record<string, (typeof H3_TIERS)[string]>)["gemini-2.5-flash"] = { id: "gemini-2.5-flash", provider: "gemini", model: "gemini-2.5-flash", contextTier: "standard" }
// Gemini returned 402 (prepayment credits depleted) on the first cell; OpenAI mini-class fallback per the brief.
;(H3_TIERS as Record<string, (typeof H3_TIERS)[string]>)["gpt-4o-mini"] = { id: "gpt-4o-mini", provider: "openai", model: "gpt-4o-mini", contextTier: "standard" }

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }
const r = await runH3({
  out: arg("out")!, traceRoot: arg("trace-root")!, tiers: arg("tier")!.split(","),
  k: Number(arg("k", "3")), budgetSec: Number(arg("budget-sec", "560")), cellTimeoutSec: Number(arg("cell-timeout-sec", "150")),
  ...(arg("start-margin-sec") ? { startMarginSec: Number(arg("start-margin-sec")) } : {}),
  ...(arg("suite") === "long-horizon" ? { suite: "long-horizon" as const } : {}),
  ...(arg("task") ? { taskFilter: arg("task")!.split(",") } : {}),
})
if (r.error) { console.error(r.error); process.exit(2) }
console.error(`[h3] ran=${r.ran} remaining=${r.remaining}`)
process.exit(0)
