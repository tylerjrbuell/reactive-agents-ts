// Build the gate's paired set per arm: one results file per (arm, tier) holding the 240 s cells
// except the three (tier, task) pairs rerun at 480 s, which come from the lt files instead.
//   bun sel.ts   -> writes sel/<arm>-sel-<tier>.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
const D = "/home/tylerbuell/.claude/jobs/eaddf328/tmp/abl-ic"
const LT = new Set(["qwen3:4b|lh-debug-green", "qwen3:4b|lh-enumerate-audit", "qwen3:14b|lh-enumerate-audit"])
mkdirSync(`${D}/sel`, { recursive: true })
for (const arm of ["auto", "ic"]) for (const slug of ["qwen3-4b", "cogito-8b", "qwen3-14b"]) {
  const lh = JSON.parse(readFileSync(`${D}/${arm}-lh-${slug}.json`, "utf8")) as { gitSha: string; cells: Array<{ tier: string; taskId: string }> }
  const ltPath = `${D}/${arm}-lt-${slug}.json`
  const lt = existsSync(ltPath) ? (JSON.parse(readFileSync(ltPath, "utf8")) as typeof lh) : { gitSha: lh.gitSha, cells: [] }
  const cells = [...lh.cells.filter((c) => !LT.has(`${c.tier}|${c.taskId}`)), ...lt.cells.filter((c) => LT.has(`${c.tier}|${c.taskId}`))]
  if (lt.gitSha !== lh.gitSha) throw new Error(`sha mismatch ${slug}`)
  writeFileSync(`${D}/sel/${arm}-sel-${slug}.json`, JSON.stringify({ ...lh, cells }, null, 1))
  console.log(arm, slug, cells.length)
}
