// Per-run code-execute scan. bun ce-scan.ts <results.json>...
// engaged = >=1 code-execute tool-call-start; never-executed = no "executed":true (or pre-execution marker);
// valued = executed:true with non-null result or non-empty output and no failure marker.
import { readFileSync, existsSync } from "node:fs"

interface Cell { taskId: string; tier: string; run: number; solved: boolean; accuracy: number | null; tokens: number; billedTokens?: number; iterations: number; traceFile?: string; causeLabel: string }
type Ev = Record<string, unknown> & { kind: string; seq: number; toolName?: string }

const PRE = /not supported|is a shell command|must be one of|Unexpected|must be initialized|JSON Parse error|Nothing was executed|SyntaxError|is not valid JavaScript/
const REP = /already called code-execute|Stop repeating/

const classify = (s: string): "valued" | "never-executed" | "repeat-guard" | "ran-failed" => {
  if (REP.test(s)) return "repeat-guard"
  const exec = /"executed":\s*true/.test(s) || /\\"executed\\":\s*true/.test(s)
  if (exec) {
    const u = s.replace(/\\"/g, '"')
    const nullRes = /"result":\s*null/.test(u) && /"output":\s*"(\(no output\))?"/.test(u)
    return nullRes || /"exitCode":\s*[1-9]/.test(s) ? "ran-failed" : "valued"
  }
  if (PRE.test(s)) return "never-executed"
  return "ran-failed"
}

let totalRuns = 0, engagedRuns = 0, valuedRuns = 0, calls = 0, failed = 0, never = 0, repeat = 0, tok = 0, solved = 0
for (const file of process.argv.slice(2)) {
  const cells = (JSON.parse(readFileSync(file, "utf8")) as { cells: Cell[] }).cells
  const per = new Map<string, { n: number; eng: number; val: number; calls: number; fail: number; never: number; sol: number; tok: number }>()
  for (const c of cells) {
    const key = `${c.tier}|${c.taskId}`
    const p = per.get(key) ?? { n: 0, eng: 0, val: 0, calls: 0, fail: 0, never: 0, sol: 0, tok: 0 }
    const evs: Ev[] = c.traceFile && existsSync(c.traceFile) ? readFileSync(c.traceFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev) : []
    const starts = evs.filter((e) => e.kind === "tool-call-start" && e.toolName === "code-execute")
    const ends = evs.filter((e) => e.kind === "tool-call-end" && e.toolName === "code-execute")
    const cls = ends.map((e) => {
      const { args: _a, ...rest } = e as Record<string, unknown>
      return classify(JSON.stringify(rest))
    })
    const v = cls.filter((x) => x === "valued").length
    const nv = cls.filter((x) => x === "never-executed").length
    const rg = cls.filter((x) => x === "repeat-guard").length
    const fl = cls.length - v
    const eng = starts.length > 0
    p.n++; p.eng += eng ? 1 : 0; p.val += v > 0 ? 1 : 0; p.calls += cls.length; p.fail += fl; p.never += nv; p.sol += c.solved ? 1 : 0; p.tok += c.billedTokens ?? c.tokens
    per.set(key, p)
    totalRuns++; engagedRuns += eng ? 1 : 0; valuedRuns += v > 0 ? 1 : 0; calls += cls.length; failed += fl; never += nv; repeat += rg; tok += c.billedTokens ?? c.tokens; solved += c.solved ? 1 : 0
    console.log(`${key} run${c.run} solved=${c.solved} acc=${(c.accuracy ?? 0).toFixed(2)} tok=${c.billedTokens ?? c.tokens} it=${c.iterations} engaged=${eng} calls=${cls.length} valued=${v} never=${nv} repeatGuard=${rg} classes=[${cls.join(",")}] cause=${c.causeLabel}`)
  }
  console.log(`--- ${file}`)
  for (const [k, p] of per) console.log(`${k}: n=${p.n} solved=${p.sol} engaged=${p.eng} valuedRuns=${p.val} calls=${p.calls} failed=${p.fail} neverExec=${p.never} tok/run=${(p.tok / p.n).toFixed(0)}`)
}
console.log(`TOTAL runs=${totalRuns} solved=${solved} engaged=${engagedRuns} valuedRuns=${valuedRuns} calls=${calls} failed=${failed} neverExec=${never} (${failed ? ((100 * never) / failed).toFixed(0) : "n/a"}% of failed) repeatGuard=${repeat} tok/run=${totalRuns ? (tok / totalRuns).toFixed(0) : 0}`)
