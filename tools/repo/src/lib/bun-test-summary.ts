/** Parsed result of a `bun test` log. A field is `null` when the log did not report it. */
export interface TestSummary {
  pass: number | null
  fail: number | null
  skip: number | null
  /**
   * Unhandled errors bun counted (` N error(s)` footer): errors thrown outside any test, e.g. at file load
   * or between tests. bun exits non-zero for them even when `fail` is 0. `0` when the footer omits the line.
   */
  errors: number | null
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
 * An `# Unhandled error between tests` block becomes the failure `unhandled error in <file>: <message>`
 * (file = the last `path/x.test.ts:` header), so a run with `0 fail` but ` 1 error` still names its cause.
 */
export function summarizeBunTest(log: string): TestSummary {
  const lines = log.replace(ANSI, "").split(/\r?\n/)
  const failures: string[] = []
  const errors: string[] = []
  const details: Record<string, readonly string[]> = {}
  let block: string[] = []
  let haveFrame = false
  let file: string | undefined
  let unhandled = false
  /** `block` already belongs to an unhandled-error failure; a later `(fail)` line must not claim it. */
  let owned = false
  for (const l of lines) {
    const header = /^(\S.*\.(?:test|spec)\.[cm]?[jt]sx?):\s*$/.exec(l)
    if (header && header[1] !== undefined) {
      file = header[1]
      continue
    }
    if (/^#\s*Unhandled error/i.test(l)) {
      unhandled = true
      continue
    }
    if (unhandled) {
      const u = /^\s*(?:error|\w*Error):\s*(.+?)\s*$/.exec(l)
      if (u && u[1] !== undefined) {
        unhandled = false
        const name = `unhandled error in ${file ?? "unknown file"}: ${u[1]}`
        if (!failures.includes(name)) failures.push(name)
        // Same array as `block`: the frame lines that follow are appended to this failure's details.
        block = [`error: ${u[1]}`]
        details[name] = block
        owned = true
        haveFrame = false
        continue
      }
    }
    const f = /^\s*\(fail\)\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l) ?? /^\s*[✗✘×]\s+(.*?)(?:\s+\[[\d.]+m?s\])?\s*$/.exec(l)
    if (f && f[1] !== undefined) {
      if (!failures.includes(f[1])) failures.push(f[1])
      if (!owned && block.length > 0 && details[f[1]] === undefined) details[f[1]] = block
      block = []
      owned = false
      haveFrame = false
      continue
    }
    const e = /^\s*error:\s*(.+?)\s*$/.exec(l)
    if (e && e[1] !== undefined) {
      if (!errors.includes(e[1])) errors.push(e[1])
      block = [`error: ${e[1]}`]
      owned = false
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
    errors: count(lines, "errors?") ?? (pass === null && fail === null ? null : 0),
    failures: useErrors ? errors : failures,
    details: useErrors ? {} : details,
  }
}
