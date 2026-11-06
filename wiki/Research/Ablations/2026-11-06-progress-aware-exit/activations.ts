// Count progressAwareExit (PAE) and 2f activations per cell in H3 results files.
// PAE activation = guard-fired {guard: progress_aware_exit, outcome: block, reason: progress_since_last_exit}.
// 2f activation  = guard-fired {guard: loop_resolution, outcome: block, reason: progress_since_last_loop}.
// Also lists every soft-exit guard event with its exit-gate decision via the
// gate-decision-aware reader (packages/trace/src/guard-run-end.ts).
//   bun activations.ts <results.json> [...]
import { readFileSync, existsSync } from "node:fs"
import { gateDecisionFor, guardEndedRun } from "/home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3/packages/trace/src/guard-run-end.ts"

type Ev = Record<string, unknown> & { kind?: unknown; guard?: unknown; outcome?: unknown; iter?: unknown; reason?: unknown }
const SOFT = new Set(["loop_resolution", "stall", "dispatcher_early_stop", "dispatcher-early-stop", "low_delta", "low-delta"])

const tot = { pae: 0, f2: 0, runs: 0, paeRuns: 0, f2Runs: 0, stallEnded: 0 }
for (const file of process.argv.slice(2)) {
  const res = JSON.parse(readFileSync(file, "utf8")) as { gitSha: string; cells: Array<{ cellId: string; traceFile: string | null; accuracy: number | null; terminatedBy: string | null; billedTokens: number | null }> }
  console.log(`# ${file} sha=${res.gitSha}`)
  for (const c of res.cells) {
    tot.runs++
    if (!c.traceFile || !existsSync(c.traceFile)) { console.log(`${c.cellId} NO-TRACE acc=${c.accuracy} term=${c.terminatedBy}`); continue }
    const evs = readFileSync(c.traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Ev)
    let pae = 0, f2 = 0
    const soft: string[] = []
    evs.forEach((e, i) => {
      if (e.kind !== "guard-fired") return
      if (e.guard === "progress_aware_exit" && e.outcome === "block" && e.reason === "progress_since_last_exit") pae++
      if (e.guard === "loop_resolution" && e.outcome === "block" && e.reason === "progress_since_last_loop") f2++
      if (typeof e.guard === "string" && (SOFT.has(e.guard) || e.guard.includes("stall") || e.guard.includes("early"))) {
        const ended = guardEndedRun(evs, i)
        if (ended && e.guard.includes("stall")) tot.stallEnded++
        soft.push(`it${String(e.iter)}:${e.guard}:${String(e.outcome)}/gate=${gateDecisionFor(evs, i) ?? "-"}/ended=${ended}`)
      }
    })
    tot.pae += pae; tot.f2 += f2
    if (pae > 0) tot.paeRuns++
    if (f2 > 0) tot.f2Runs++
    console.log(`${c.cellId} acc=${c.accuracy} term=${c.terminatedBy} billed=${c.billedTokens} PAE=${pae} 2f=${f2} [${soft.join(" ")}]`)
  }
}
console.log(`ACTIVATIONS pae=${tot.pae} paeRuns=${tot.paeRuns} 2f=${tot.f2} f2Runs=${tot.f2Runs} runs=${tot.runs} stallEndedRuns(gate-aware)=${tot.stallEnded}`)
