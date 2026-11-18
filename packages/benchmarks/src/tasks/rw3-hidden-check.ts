// File: src/tasks/rw3-hidden-check.ts
//
// rw-3 hidden check generator, split out of real-world.ts (file-size ceiling).
// Scorer v2 (2026-11-18): claims must be about Engineering; see ../scorer-version.ts.

import { gradedCheckHarness } from "./graded-check.js"

/**
 * rw-3 hidden check — graded structural + groundedness accuracy
 * (2026-07-11 keyword→graded conversion wave).
 *
 * The employee fixture is deterministic (generateEmployeeData), so the
 * actionable finding has fixed numbers: Engineering averages ≈ $144,600 against
 * a company average ≈ $102,240 (a ≈ 41% premium) while carrying the LOWEST
 * performance (≈ 2.68 avg, every other dept ≥ 3.4). The check accepts the
 * claim grounded EITHER way (the averages or the premium percent) and never
 * pins a required phrasing — only that the report is structured, surfaces the
 * outlier, grounds it in real numbers, and lands a recommendation.
 * "Open-ended, no recipe" stays true: the prompt is unchanged.
 */
export function generateRw3HiddenCheck(): string {
  return `// hidden-check.ts — scorer-written validation of report.md. Not agent-authored.
${gradedCheckHarness()}
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const path = join(import.meta.dir, "report.md")
const raw = existsSync(path) ? readFileSync(path, "utf8") : ""
check("report.md exists and is substantive", () =>
  raw.replace(/\\s+/g, " ").length >= 300 && !/\\b(TODO|TBD|lorem ipsum|placeholder)\\b/i.test(raw))

// No table is requested: a pipe table or 3+ numeric list lines both pass.
check("presents data in a structured form", () => {
  return raw.split("\\n").filter((l) => (l.match(/\\|/g) ?? []).length >= 2 || (/^\\s*([-*•]|\\d+[.)])\\s+/.test(l) && /\\d/.test(l))).length >= 3
})

// Claims are checked per segment (a table row, a list line, or one prose
// sentence), and each must be ABOUT Engineering: a "40%" or a salary-shaped
// number anywhere else in the report earns nothing (audit 02 D5).
const segs = raw.split(/\\n\\s*\\n/).flatMap((p) => {
  const lines = p.split("\\n")
  const listy = lines.some((l) => /^\\s*(\\||[-*•]\\s|\\d+[.)]\\s)/.test(l))
  return listy ? lines : p.replace(/\\s*\\n\\s*/g, " ").split(/(?<=[.!?])\\s+/)
})
const aboutEng = segs.filter((s) => /engineer/i.test(s))

check("surfaces Engineering as the outlier department", () =>
  aboutEng.some((s) => /outlier|highest|top\\b|premium|above|higher|more than|exceed|stands?\\s+out|lowest|worst|lag|below|underperform|paid|pay\\b|salar|compensat/i.test(s)))

check("salary claim is grounded in the data", () => {
  // The Engineering average (144,600 = $144.6k, band [138k, 152k]) or the premium (41.4%, band 35-49%).
  const k = (s: string) => [...s.replace(/[,_$]/g, "").matchAll(/(?<![\\d.])(\\d{3}(?:\\.\\d+)?)\\s*k\\b/gi)].map((m) => Number(m[1]) * 1000)
  const big = (s: string) => [...s.replace(/[,_$]/g, "").matchAll(/(?<![\\d.])(\\d{5,6})(?![\\d])/g)].map((m) => Number(m[1]))
  return aboutEng.some((s) => {
    const engAvg = [...big(s), ...k(s)].some((n) => n >= 138000 && n <= 152000)
    const premium = /\\b(3[5-9]|4[0-9])(\\.\\d+)?\\s*(%|percent|per\\s*cent)/i.test(s) &&
      /premium|above|higher|more|exceed|over|paid|pay\\b|salar|compensat|average|avg/i.test(s)
    return engAvg || premium
  })
})

check("connects salary to the performance dimension", () =>
  // The Engineering average is 2.68 against 3.64+ elsewhere: a 2.5-2.9 figure or an explicit "lowest".
  aboutEng.some((s) => /perform|rating|score/i.test(s) && (/(?<![\\d.])2\\.[5-9]\\d?(?!\\d)/.test(s) || /lowest|worst|weakest|below|under|lag|poor/i.test(s))))

check("gives a concrete recommendation", () => /recommend|suggest|propose|should|action/i.test(raw))

report()
`
}

