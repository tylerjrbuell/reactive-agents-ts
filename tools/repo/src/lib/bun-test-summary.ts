/** Parsed result of a `bun test` log. A field is `null` when the log did not report it. */
export interface TestSummary {
  pass: number | null
  fail: number | null
  skip: number | null
  failures: readonly string[]
  /**
   * Why each named failure failed: its `error:` line, the Expected/Received or diff lines, and the first
   * `at` frame, capped at DETAIL_CAP lines. Keyed by failure name; absent when the log had no error block.
   */
  details: Readonly<Record<string, readonly string[]>>
}

const ANSI = /\u001b\[[0-9;]*m/g

/** Lines kept per failure detail: enough for the assertion and its location, small enough to scan. */
export const DETAIL_CAP = 6

function count(lines: readonly string[], word: string): number | null {
  const re = new RegExp(`^\\s*(\\d+) ${word}\\s*$`)
  for (const l of lines) {
    const m = re.exec(l)
    if (m) return Number(m[1])
  }
  return null
}

/** One line of an error block worth keeping: assertion values, diff lines, or the first stack frame. */
function detailLine(l: string, haveFrame: boolean): string | undefined {
  if (/^(?:Expected|Received)(?::|\s{2})/.test(l)) return l.trim()
  if (/^[-+] {2,}\S/.test(l)) return l.trimEnd()
  const at = /^\s+at\s+(?:<anonymous>\s+)?\(?(.+?)\)?\s*$/.exec(l)
  if (at && at[1] !== undefined && !haveFrame) return `at ${at[1]}`
  return undefined
}

/**
 * Summarize a `bun test` log: counts from the ` N pass` / ` N fail` / ` N skip` footer,
 * failure names from `(fail) suite > name [12.00ms]` or `✗ name [12.00ms]` lines (duration stripped, order kept,
 * de-duplicated). When no `(fail)` line exists, `error:` lines stand in as failure names.
 * Bun prints each failure's `error:` block before its `(fail)` line; that block becomes `details[name]`.
 */
export function summarizeBunTest(log: string): TestSummary {
  const lines = log.replace(ANSI, "").split(/\r?\n/)
  const failures: string[] = []
  const errors: string[] = []
  const details: Record<string, readonly string[]> = {}
  let block: string[] = []
  let haveFrame = false
  for (const l of lines) {
    const f = /^\s*\(fail\)\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l) ?? /^\s*[✗✘×]\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l)
    if (f && f[1] !== undefined) {
      if (!failures.includes(f[1])) failures.push(f[1])
      if (block.length > 0 && details[f[1]] === undefined) details[f[1]] = block
      block = []
      haveFrame = false
      continue
    }
    const e = /^\s*error:\s*(.+?)\s*$/.exec(l)
    if (e && e[1] !== undefined) {
      if (!errors.includes(e[1])) errors.push(e[1])
      block = [`error: ${e[1]}`]
      haveFrame = false
      continue
    }
    if (block.length === 0 || block.length >= DETAIL_CAP) continue
    const d = detailLine(l, haveFrame)
    if (d === undefined) continue
    if (d.startsWith("at ")) haveFrame = true
    block.push(d)
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
    details: useErrors ? {} : details,
  }
}
