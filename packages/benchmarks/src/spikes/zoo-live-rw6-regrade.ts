// File: src/spikes/zoo-live-rw6-regrade.ts — zero-token v3 regrade of stored rw-6 cells.
//   bun run src/spikes/zoo-live-rw6-regrade.ts <results.json>[,<results.json>...]
// Per cell: recorded (v2) solved vs v3 solved and the figures `fabricatedFigures` found in the
// final answer. v3 (judge.ts) adds one "no figures invented" check to rw-6 accuracy, so a cell is
// solved at v3 only when it was solved at v2 AND the answer has no ungrounded percent figure.
// (`regradeCell` is not used: live-graded traces already hold an `eval-graded` event, so it skips them.)
import { readFileSync } from "node:fs"
import { loadTrace } from "@reactive-agents/trace"
import { fabricatedFigures, runEvidenceOf } from "../fabrication-count.js"
import { H3_TASKS } from "../h3/tasks.js"

interface Cell { readonly taskId: string; readonly run: number; readonly accuracy: number | null; readonly solved: boolean; readonly traceFile: string | null }

const files = (process.argv[2] ?? "").split(",").filter((f) => f.length > 0)
if (files.length === 0) {
  console.error("usage: <results.json>[,<results.json>...]")
  process.exit(2)
}
const task = H3_TASKS.find((t) => t.id === "rw-6")
if (!task) {
  process.stderr.write("rw-6 not in H3_TASKS\n")
  process.exit(1)
}

for (const file of files) {
  const name = file.split("/").slice(-2).join("/")
  const cells = (JSON.parse(readFileSync(file, "utf8")) as { cells: Cell[] }).cells.filter((c) => c.taskId === "rw-6")
  let before = 0
  let after = 0
  for (const c of cells) {
    let figs: string[] = []
    if (c.traceFile) {
      const trace = await loadTrace(c.traceFile)
      const done = trace.events.filter((e) => e.kind === "run-completed").at(-1)
      const out = done?.kind === "run-completed" ? (done.output ?? "") : ""
      figs = fabricatedFigures(out, task.prompt, runEvidenceOf(trace))
    }
    const solvedV3 = c.solved && figs.length === 0
    if (c.solved) before++
    if (solvedV3) after++
    console.log(`${name} run${c.run} v2 solved=${c.solved} acc=${c.accuracy?.toFixed(2)} | v3 solved=${solvedV3} | fabricated=[${figs.join(",")}]`)
  }
  console.log(`== ${name}: solved v2 ${before}/${cells.length} -> v3 ${after}/${cells.length}`)
}
