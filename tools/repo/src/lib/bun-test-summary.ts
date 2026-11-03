/** Parsed result of a `bun test` log. A field is `null` when the log did not report it. */
export interface TestSummary {
  pass: number | null
  fail: number | null
  skip: number | null
  failures: readonly string[]
}

const ANSI = /\u001b\[[0-9;]*m/g

function count(lines: readonly string[], word: string): number | null {
  const re = new RegExp(`^\\s*(\\d+) ${word}\\s*$`)
  for (const l of lines) {
    const m = re.exec(l)
    if (m) return Number(m[1])
  }
  return null
}

/**
 * Summarize a `bun test` log: counts from the ` N pass` / ` N fail` / ` N skip` footer,
 * failure names from `(fail) suite > name [12.00ms]` or `✗ name [12.00ms]` lines (duration stripped, order kept,
 * de-duplicated). When no `(fail)` line exists, `error:` lines stand in as failure names.
 */
export function summarizeBunTest(log: string): TestSummary {
  const lines = log.replace(ANSI, "").split(/\r?\n/)
  const failures: string[] = []
  const errors: string[] = []
  for (const l of lines) {
    const f = /^\s*\(fail\)\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l)
    if (f && f[1] !== undefined && !failures.includes(f[1])) failures.push(f[1])
    const x = /^\s*[✗✘×]\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l)
    if (x && x[1] !== undefined && !failures.includes(x[1])) failures.push(x[1])
    const e = /^\s*error:\s*(.+?)\s*$/.exec(l)
    if (e && e[1] !== undefined && !errors.includes(e[1])) errors.push(e[1])
  }
  const fail = count(lines, "fail")
  const pass = count(lines, "pass")
  const useErrors = failures.length === 0 && (fail === null || fail > 0)
  return {
    pass,
    fail,
    // bun omits the skip line when nothing was skipped; only a footer-less log leaves it unknown.
    skip: count(lines, "skip") ?? (pass === null && fail === null ? null : 0),
    failures: useErrors ? errors : failures,
  }
}
