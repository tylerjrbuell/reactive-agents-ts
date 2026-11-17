/**
 * Turn a piped `bun test` call into the equivalent `bun run repo test` call, so the hook can fix the
 * command instead of denying it. Agents pipe tests to trim output (`| tail -30`, `| grep fail`);
 * `repo test` already prints the trimmed view (counts, failing names, error excerpts) and logs the rest.
 *
 * Only plain shapes are rewritten; anything else returns undefined and the normal deny stands:
 *   [cd <abs dir in repo> (; | &&)] [timeout <s>] bun test <paths…> [--timeout <ms>] [-t <pattern>] [2>&1] | <filter> [| <filter>…]
 * where every filter is tail, head, grep or egrep. Paths become repo-relative (a `cd` into a subdir
 * prefixes them). Shell control (`;`, `&&`, `||`, redirects to files, `$(`, backticks) anywhere else
 * means "not a plain test call".
 */

const FILTERS = new Set(["tail", "head", "grep", "egrep"])

/** Bash `timeout` (ms) for the rewritten call: the run's wall-clock limit plus slack, within Bash's 600 s cap. */
export function bashTimeoutFor(maxSeconds: number): number {
  return Math.min(600_000, (maxSeconds + 15) * 1000)
}

/** Result of a rewrite: the new command and the wall-clock limit it runs under. */
export interface TestRewrite {
  command: string
  maxSeconds: number
}

/** Split on whitespace, honouring simple '…' / "…" quotes (no escapes). Undefined on an unbalanced quote. */
function tokens(s: string): string[] | undefined {
  const out: string[] = []
  const re = /\s*(?:'([^']*)'|"([^"\\$`]*)"|([^\s'"]+))/y
  let m: RegExpExecArray | null
  let pos = 0
  while (pos < s.length && (m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "")
    pos = re.lastIndex
    if (/^\s*$/.test(s.slice(pos))) return out
  }
  return /^\s*$/.test(s.slice(pos)) ? out : undefined
}

function quote(s: string): string {
  return /^[\w./@:=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Split on `|` outside quotes. Undefined when the unquoted text holds other shell control
 * (`;`, `&`, `||`, backticks, `$(`, a newline) or a quote is unbalanced.
 */
function splitPipes(s: string): string[] | undefined {
  const out: string[] = []
  let cur = ""
  let q: string | undefined
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (q !== undefined) {
      if (c === q) q = undefined
      cur += c
      continue
    }
    if (c === "'" || c === '"') q = c
    else if (c === ";" || c === "\n" || c === "`" || (c === "$" && s[i + 1] === "(")) return undefined
    else if (c === "&" && !(s.slice(i - 1, i + 1) === ">&" && s[i + 1] === "1")) return undefined
    else if (c === "|") {
      if (s[i + 1] === "|") return undefined
      out.push(cur)
      cur = ""
      continue
    }
    cur += c
  }
  if (q !== undefined) return undefined
  out.push(cur)
  return out
}

/**
 * Strip a leading `cd <dir>;` / `cd <dir> &&` and return the rest plus `dir` relative to the root
 * ("" for the root itself). Undefined when it cds outside the repo or to a relative dir.
 */
function dropCd(command: string, root: string): { body: string; sub: string } | undefined {
  const m = /^\s*cd\s+(\S+)\s*(?:;|&&)\s*/.exec(command)
  if (!m) return { body: command, sub: "" }
  const dir = (m[1] ?? "").replace(/\/+$/, "")
  const r = root.replace(/\/+$/, "")
  if (dir === r) return { body: command.slice(m[0].length), sub: "" }
  if (dir.startsWith(`${r}/`) && !dir.includes("..")) return { body: command.slice(m[0].length), sub: `${dir.slice(r.length + 1)}/` }
  return undefined
}

/** The `repo test` equivalent of a plain piped `bun test` command, or undefined when it is not plain. */
export function rewritePipedTest(command: string, root: string, defaultMaxSeconds = 600): TestRewrite | undefined {
  const cd = dropCd(command, root)
  if (cd === undefined) return undefined
  const segments = splitPipes(cd.body)
  if (segments === undefined) return undefined
  if (segments.length < 2) return undefined
  const head = (segments[0] ?? "").replace(/\s2>&1\s*$/, " ").trimEnd()
  if (/[<>]/.test(head)) return undefined
  for (const seg of segments.slice(1)) {
    const word = (seg.trim().split(/\s+/)[0] ?? "").replace(/^\/usr\/bin\/|^\/bin\//, "")
    if (!FILTERS.has(word) || /[<>]/.test(seg.replace(/'[^']*'|"[^"]*"/g, ""))) return undefined
  }
  const t = tokens(head)
  if (t === undefined) return undefined
  let i = 0
  let maxSeconds = defaultMaxSeconds
  if (t[i] === "timeout") {
    const s = Number(t[i + 1])
    if (!Number.isInteger(s) || s <= 0) return undefined
    maxSeconds = s
    i += 2
  }
  if (t[i] !== "bun" || t[i + 1] !== "test") return undefined
  i += 2
  const paths: string[] = []
  let timeout: string | undefined
  let pattern: string | undefined
  for (; i < t.length; i++) {
    const a = t[i] as string
    const eq = /^--timeout=(\d+)$/.exec(a)
    if (eq) timeout = eq[1]
    else if (a === "--timeout" && /^\d+$/.test(t[i + 1] ?? "")) timeout = t[++i]
    else if ((a === "-t" || a === "--test-name-pattern") && t[i + 1] !== undefined) pattern = t[++i]
    else if (a.startsWith("-")) return undefined
    else if (a.startsWith("/")) paths.push(a.startsWith(`${root.replace(/\/+$/, "")}/`) ? a.slice(root.replace(/\/+$/, "").length + 1) : a)
    else if (a.includes("..")) return undefined
    // A bare filter word (`seam`) is a substring match: it only keeps its meaning from the root.
    else if (cd.sub !== "" && !/\/|\.[cm]?[jt]sx?$/.test(a)) return undefined
    else paths.push(`${cd.sub}${a}`)
  }
  if (paths.length === 0) return undefined
  const parts = ["bun run repo test", ...paths.map(quote)]
  if (timeout !== undefined) parts.push("--timeout", timeout)
  if (pattern !== undefined) parts.push("-t", quote(pattern))
  if (maxSeconds !== defaultMaxSeconds) parts.push("--max-seconds", String(maxSeconds))
  return { command: parts.join(" "), maxSeconds }
}
