// Ablation wrapper: parallelToolHint and leanFinalTurn vs off, frozen H3 cells plus
// one golden-run-shaped cell, arms interleaved per (run, task) in ONE process (same
// build, same host conditions). Arms are env-selected (read per call by harness-flags):
//   off  = neither flag
//   pth  = RA_PARALLEL_TOOL_HINT=1   (fires only for parallel-`reliable` calibrations)
//   lft  = RA_LEAN_FINAL_TURN=1
// Registers two tiers the H3 table does not carry (both are in STATIC_CAPABILITIES and
// have committed calibrations rating parallelCallCapability "reliable"):
//   gemma4:e4b, cogito:14b
// Adds one task the frozen suite does not carry: `golden-moons` (the docs golden-run
// prompt, web-search + 2 file-writes, scored by a deterministic hidden check).
// Run from the pinned worktree so gitSha() records the measured SHA:
//   env -C /home/tylerbuell/Documents/AIProjects/reactive-agents-ts bun <this> --tier gemma4:e4b --k 5 --out-dir <abs> [--task a,b] [--budget-sec 580] [--cell-timeout-sec 180]
import { H3_TIERS, runH3 } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/run-h3.ts"
import { H3_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/tasks.ts"
import { gradedCheckHarness } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/tasks/graded-check.ts"
import type { BenchmarkTask } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/types.ts"

const arg = (n: string, d?: string): string | undefined => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d }

const T = H3_TIERS as Record<string, (typeof H3_TIERS)[string]>
T["gemma4:e4b"] = { id: "gemma4:e4b", provider: "ollama", model: "gemma4:e4b", contextTier: "local" }
T["cogito:14b"] = { id: "cogito:14b", provider: "ollama", model: "cogito:14b", contextTier: "local" }

const GOLDEN: BenchmarkTask = {
  id: "golden-moons",
  tier: "real-world",
  name: "Golden run: moon counts, report + JSON",
  domain: "research",
  strategy: "react",
  prompt: `Compare the moon counts of Jupiter, Saturn, and Mars. Write a markdown report to ./report.md and the raw data as a JSON array to ./data.json.`,
  requiresTools: true,
  tools: [
    { kind: "required", name: "web-search" },
    { kind: "required", name: "file-write" },
  ],
  maxIterations: 10,
  fixtures: [],
  hiddenFixtures: [
    {
      path: "hidden-check.ts",
      content: `${gradedCheckHarness()}
import { existsSync, readFileSync } from "node:fs"
const read = (p: string): string => (existsSync(p) ? readFileSync(p, "utf8") : "")
const rows = (): unknown[] => { try { const j = JSON.parse(read("data.json")); return Array.isArray(j) ? j : [] } catch { return [] } }
const numFor = (name: string): number | null => {
  const r = rows().find((x) => JSON.stringify(x).toLowerCase().includes(name))
  if (!r || typeof r !== "object") return null
  const n = Object.values(r as Record<string, unknown>).find((v) => typeof v === "number")
  return typeof n === "number" ? n : null
}
check("report.md names all three planets", () => ["jupiter", "saturn", "mars"].every((p) => read("report.md").toLowerCase().includes(p)))
check("data.json is a JSON array of 3", () => rows().length === 3)
check("Mars has 2 moons in data.json", () => numFor("mars") === 2)
check("Jupiter count plausible (79-120)", () => { const n = numFor("jupiter"); return n !== null && n >= 79 && n <= 120 })
check("Saturn count plausible (82-300)", () => { const n = numFor("saturn"); return n !== null && n >= 82 && n <= 300 })
report()
`,
    },
  ],
  successCriteria: { type: "verifiable", command: "bun hidden-check.ts", partialCredit: true },
  tags: ["h3", "golden-run"],
}
;(H3_TASKS as BenchmarkTask[]).push(GOLDEN)

const ARMS: Record<string, Record<string, string>> = {
  off: {},
  pth: { RA_PARALLEL_TOOL_HINT: "1" },
  lft: { RA_LEAN_FINAL_TURN: "1" },
}
const FLAGS = ["RA_PARALLEL_TOOL_HINT", "RA_LEAN_FINAL_TURN"]

const tier = arg("tier")!
if (!T[tier]) { console.error(`unknown tier ${tier}`); process.exit(2) }
const outDir = arg("out-dir")!
const k = Number(arg("k", "5"))
const budgetSec = Number(arg("budget-sec", "580"))
const cellT = Number(arg("cell-timeout-sec", "180"))
const DEFAULT_TASKS = ["h3-todo-heavy", "h3-required-tools", "h3-continuation", "h3-exact-value", "ab-trap-5", "golden-moons"]
const tasks = arg("task") ? arg("task")!.split(",") : DEFAULT_TASKS
const arms = arg("arms") ? arg("arms")!.split(",") : Object.keys(ARMS)
const slug = tier.replace(/[^\w.-]/g, "_")
const started = Date.now()
let ran = 0
let remaining = 0
for (let run = 0; run < k; run++) for (const task of tasks) for (const arm of arms) {
  for (const f of FLAGS) delete process.env[f]
  Object.assign(process.env, ARMS[arm])
  const left = budgetSec - (Date.now() - started) / 1000
  const r = await runH3({
    out: `${outDir}/${arm}-h3-${slug}.json`, traceRoot: `${outDir}/traces-${arm}`, tiers: [tier],
    k: run + 1, budgetSec: Math.max(0, left), cellTimeoutSec: cellT, startMarginSec: cellT + 5, taskFilter: [task],
  })
  if (r.error) { console.error(r.error); process.exit(2) }
  ran += r.ran
  remaining += r.remaining
}
for (const f of FLAGS) delete process.env[f]
console.error(`[ab] ran=${ran} remaining=${remaining} elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`)
process.exit(0)
