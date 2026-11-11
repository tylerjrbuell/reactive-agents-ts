// Lift gate over a to-session report with Ollama tiers marked token-free
// (LiftGateOptions.isTokenFreeTier; owner ruling 2026-11-06, same as run.ts --gate).
// `rax eval gate` cannot pass isTokenFreeTier, so this calls the same library
// functions (evaluateLiftGate, formatGateReceipt, recordGateOutcome, saveLedger).
//   bun gate.ts <session.json> <baseline> <candidate> <activations> <tokenFreeTiers,csv|-> [ledger] [weakness] [hypothesis]
import { readFileSync } from "node:fs"
import { evaluateLiftGate, formatGateReceipt, DEFAULT_LIFT_POLICY, recordGateOutcome, loadLedger, saveLedger } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/index.ts"
import { LONG_HORIZON_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/tasks/long-horizon.ts"
import { LH_TASKS } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/benchmarks/src/h3/long-horizon-tasks.ts"

const [path, baseline, candidate, act, free, ledger, weakness, hypothesis] = process.argv.slice(2)
const report = JSON.parse(readFileSync(path!, "utf8"))
const freeSet = new Set(free && free !== "-" ? free.split(",") : [])
const tasks = [...LONG_HORIZON_TASKS, ...LH_TASKS].map((t) => ({ id: t.id, tags: [...(t.tags ?? [])] }))
const options = { tasks, isTokenFreeTier: (t: string) => freeSet.has(t) }
const verdict = evaluateLiftGate(report, baseline!, candidate!, DEFAULT_LIFT_POLICY, options)
console.log(formatGateReceipt(verdict, DEFAULT_LIFT_POLICY))
console.log(`activations (candidate runs with >=1 forced request): ${act}`)
if (ledger) {
  const l = await loadLedger(ledger)
  const u = recordGateOutcome(l, { id: crypto.randomUUID(), createdAt: new Date().toISOString(), weakness: weakness ?? `${candidate} vs ${baseline}`, hypothesis: hypothesis ?? candidate, metric: DEFAULT_LIFT_POLICY.metric, verdict, activations: Number(act) })
  await saveLedger(ledger, u)
  console.log(`Recorded to improvement ledger: ${ledger} (${u.entries.length} entries)`)
}
