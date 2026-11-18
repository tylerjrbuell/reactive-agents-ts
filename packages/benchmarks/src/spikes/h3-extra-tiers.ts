// File: src/spikes/h3-extra-tiers.ts — run-h3 CLI with extra local tiers registered.
// Use as the bench:drive `runnerCmd` (["bun","run",<this file>]); args are run-h3's.
// Adds gemma4:e4b (the demo model; in STATIC_CAPABILITIES, absent from H3_TIERS).
import { H3_TIERS, runH3 } from "../h3/run-h3.js"
import { DEFAULT_CELL_TIMEOUT_SEC } from "../preflight-provenance.js"

H3_TIERS["gemma4:e4b"] = { id: "gemma4:e4b", provider: "ollama", model: "gemma4:e4b", contextTier: "local" }

const arg = (name: string, def?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : def
}

const out = arg("out")
const traceRoot = arg("trace-root")
const tier = arg("tier")
if (!out || !traceRoot || !tier) {
  console.error("usage: --out <abs.json> --trace-root <abs dir> --tier a,b [--k N] [--budget-sec N] [--cell-timeout-sec N] [--task id,id] [--allow-contention]")
  process.exit(2)
}
const r = await runH3({
  out, traceRoot,
  tiers: tier.split(","),
  k: Number(arg("k", "5")),
  budgetSec: Number(arg("budget-sec", "560")),
  cellTimeoutSec: Number(arg("cell-timeout-sec", String(DEFAULT_CELL_TIMEOUT_SEC))),
  allowContention: process.argv.includes("--allow-contention"),
  ...(arg("start-margin-sec") ? { startMarginSec: Number(arg("start-margin-sec")) } : {}),
  noSwitch: process.argv.includes("--no-switch"),
  ...(arg("task") ? { taskFilter: arg("task")!.split(",") } : {}),
})
if (r.error) {
  console.error(r.error)
  process.exit(2)
}
console.error(`[h3] ran=${r.ran} remaining=${r.remaining}`)
process.exit(0)
