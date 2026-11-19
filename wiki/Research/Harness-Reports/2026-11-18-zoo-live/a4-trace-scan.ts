// Scan one results file: per cell solved/tokens, duplicateGuard refusal fired, refusal names an unread input,
// and whether the model then read that named input. bun a4-trace-scan.ts <results.json>
import { readFileSync } from "node:fs"
interface Cell { run: number; solved: boolean; accuracy: number | null; tokens: number; billedTokens?: number; iterations: number; traceFile?: string; causeLabel: string }
interface Ev { kind: string; seq: number; toolName?: string; args?: { path?: string }; messages?: Array<{ content?: unknown }> }
const cells = (JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { cells: Cell[] }).cells
let fired = 0, named = 0, firedSolved = 0, followed = 0, solved = 0, tok = 0
for (const c of cells) {
  const evs: Ev[] = c.traceFile ? readFileSync(c.traceFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Ev) : []
  let firstSeq = -1, path = ""
  for (const e of evs) {
    if (e.kind !== "llm-exchange") continue
    const s = JSON.stringify(e.messages ?? [])
    if (/Already done.{1,8}do NOT repeat/.test(s)) { firstSeq = e.seq; const m = s.match(/Read ([^\s"\\]+) first: it is a listed input/); path = m?.[1] ?? ""; break }
  }
  const refusal = firstSeq >= 0, names = path !== ""
  const readNamed = names && evs.some((e) => e.kind === "tool-call-start" && e.toolName === "file-read" && e.seq > firstSeq && e.args?.path === path)
  if (refusal) fired++; if (names) named++; if (refusal && c.solved) firedSolved++; if (readNamed) followed++
  if (c.solved) solved++
  tok += c.billedTokens ?? c.tokens
  console.log(`run${c.run} solved=${c.solved} acc=${(c.accuracy ?? 0).toFixed(2)} tok=${c.billedTokens ?? c.tokens} it=${c.iterations} refusal=${refusal} namesUnread=${names}${names ? "(" + path.split("/").pop() + ")" : ""} readNamedAfter=${readNamed} cause=${c.causeLabel}`)
}
console.log(`n=${cells.length} solved=${solved} refusalFired=${fired} named=${named} followedByRead=${followed} firedSolved=${firedSolved} tok/run=${(tok / cells.length).toFixed(0)} tok/solved=${solved ? (tok / solved).toFixed(0) : "n/a"}`)
