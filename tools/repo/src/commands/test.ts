import { spawn } from "node:child_process"
import { closeSync, type Dirent, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { summarizeBunTest, type TestSummary } from "../lib/bun-test-summary.ts"
import type { Io } from "../lib/output.ts"
import { resolveRoot } from "../lib/root.ts"
import { acquireSlot, SLOT_HELD_ENV, slotCount } from "../lib/test-slots.ts"

/** Failure names printed before `... N more`. */
const FAILURE_CAP = 15
/** Failures that also get their error excerpt (assertion, diff, location) printed. */
const DETAIL_FAILURES = 5
/** Default per-test timeout passed to `bun test`. */
export const DEFAULT_TEST_TIMEOUT = "15000"

/** Newest `test-*` / `verify-*` logs kept; older ones are deleted on each run. `.jsonl` logs are never touched. */
export const LOG_KEEP = 50

/** Delete all but the newest `keep` `test-*.log` / `verify-*.log` files in `dir`. Best effort. */
export function pruneRunLogs(dir: string, keep: number): void {
  try {
    const logs = readdirSync(dir)
      .filter((f) => /^(?:test|verify)-.*\.log$/.test(f))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1))
    for (const old of logs.slice(keep)) rmSync(join(dir, old.f), { force: true })
  } catch {
    // Rotation must never fail a run.
  }
}

/** Path for a new log under `<root>/.repo-logs/`, creating the dir and pruning old run logs. */
export function newLogPath(root: string, prefix: string): string {
  const dir = join(root, ".repo-logs")
  mkdirSync(dir, { recursive: true })
  pruneRunLogs(dir, LOG_KEEP - 1)
  return join(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.log`)
}

/** Default wall-clock limit for a child, in seconds. */
export const DEFAULT_MAX_SECONDS = 600
/** Grace between SIGTERM and SIGKILL on timeout. */
const KILL_GRACE_MS = 5000

/**
 * Run a command with stdout+stderr sent straight to `logPath` (no pipe), colour disabled.
 * Past `maxSeconds` the child gets SIGTERM, then SIGKILL after 5s; `timedOut` is set.
 */
export function spawnLogged(
  cmd: string,
  args: readonly string[],
  cwd: string,
  logPath: string,
  maxSeconds: number = DEFAULT_MAX_SECONDS,
  extraEnv: Readonly<Record<string, string>> = {},
): Promise<{ code: number; timedOut: boolean }> {
  const fd = openSync(logPath, "w")
  return new Promise((done) => {
    const child = spawn(cmd, [...args], {
      cwd,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...extraEnv },
    })
    let timedOut = false
    let killer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGTERM")
      killer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS)
    }, maxSeconds * 1000)
    const finish = (code: number): void => {
      clearTimeout(timer)
      if (killer !== undefined) clearTimeout(killer)
      closeSync(fd)
      done({ code, timedOut })
    }
    child.on("close", (code) => finish(code ?? 1))
    child.on("error", () => finish(1))
  })
}

/** Result of one logged `bun test` run. */
export interface TestRun {
  exit: number
  summary: TestSummary
  /** Repo-relative log path. */
  log: string
  failed: boolean
  timedOut: boolean
  maxSeconds: number
  /** Absolute repo root, used to print stack locations repo-relative. */
  root?: string
}

/**
 * Run `bun test <paths>` once with output going straight to a log file. Waits for a machine-wide
 * test slot first (see `lib/test-slots.ts`); `notify` gets the one waiting line, if any.
 * `namePattern` is passed as `-t <pattern>` (bun's test-name filter).
 */
export async function execTests(
  root: string,
  paths: readonly string[],
  timeout: string,
  logPrefix = "test",
  maxSeconds: number = DEFAULT_MAX_SECONDS,
  namePattern?: string,
  notify: (line: string) => void = () => {},
): Promise<TestRun> {
  const slot = await acquireSlot(notify)
  let exit: number
  let timedOut: boolean
  const log = newLogPath(root, logPrefix)
  const filter = namePattern === undefined ? [] : ["-t", namePattern]
  try {
    ;({ code: exit, timedOut } = await spawnLogged("bun", ["test", ...paths, "--timeout", timeout, ...filter], root, log, maxSeconds, {
      [SLOT_HELD_ENV]: "1",
    }))
  } finally {
    slot.release()
  }
  const summary = summarizeBunTest(readFileSync(log, "utf8"))
  // `errors` (unhandled errors outside tests) fail a run even at `0 fail`; bun also exits 1 for them.
  const failed = summary.fail === null || summary.fail > 0 || (summary.errors ?? 0) > 0 || exit !== 0 || timedOut
  return { exit, summary, log: relative(root, log), failed, timedOut, maxSeconds, root }
}

/** Summary lines for a test run (counts, failure names capped with error excerpts for the first few, log path). */
export function describeRun(r: TestRun): string[] {
  const s = r.summary
  // A timeout has no meaningful counts: say only that, plus the log.
  if (r.timedOut) return [`fail: timeout after ${r.maxSeconds}s`, `log: ${r.log}`]
  const errors = s.errors !== null && s.errors > 0 ? `, ${s.errors} error` : ""
  const msg: string[] = [`${s.pass ?? "?"} pass, ${s.fail ?? "?"} fail, ${s.skip ?? "?"} skip${errors}`]
  if (s.fail === null) msg.push("fail: unknown")
  // A non-zero exit the counts do not explain (no failures, no errors) must still be visible.
  if (r.exit !== 0 && (s.fail === null || (s.fail === 0 && (s.errors ?? 0) === 0))) msg.push(`bun test exited ${r.exit}`)
  const prefix = r.root === undefined ? undefined : `${r.root}/`
  s.failures.slice(0, FAILURE_CAP).forEach((f, i) => {
    msg.push(`  ${f}`)
    if (i >= DETAIL_FAILURES) return
    for (const d of s.details[f] ?? []) msg.push(`      ${prefix === undefined ? d : d.split(prefix).join("")}`)
  })
  if (s.failures.length > FAILURE_CAP) msg.push(`  ... ${s.failures.length - FAILURE_CAP} more`)
  msg.push(`log: ${r.log}`)
  return msg
}

/** Run scoped tests and print the summary through `io`. Shared entry for `repo test`. Returns exit code. */
export async function runScopedTests(
  root: string,
  paths: readonly string[],
  timeout: string,
  io: Io,
  maxSeconds: number = DEFAULT_MAX_SECONDS,
  namePattern?: string,
): Promise<number> {
  const r = await execTests(root, paths, timeout, "test", maxSeconds, namePattern, (l) => void io.out(l))
  const s = r.summary
  io.data({ pass: s.pass, fail: s.fail, skip: s.skip, errors: s.errors, failures: s.failures, details: s.details, exit: r.exit, log: r.log })
  const lines = describeRun(r)
  if (!r.failed) {
    for (const l of lines) io.result(l)
    return 0
  }
  return io.fail(lines.join("\n"), `open ${r.log}`)
}

/** Top-level dirs whose children each become one `--all` chunk; `scripts` is one chunk itself. */
const SUITE_PARENTS = ["packages", "apps", "tools"] as const
const SUITE_SINGLES = ["scripts"] as const
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", ".astro", "build", "coverage"])

function hasTestFile(dir: string): boolean {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) if (e.isFile() && TEST_FILE.test(e.name)) return true
  for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name) && hasTestFile(join(dir, e.name))) return true
  return false
}

/**
 * The full suite as chunks: each `packages/<x>`, `apps/<x>`, `tools/<x>` and `scripts` that holds a
 * test file, repo-relative and sorted. One chunk per package keeps each `bun test` run far under the
 * per-run wall-clock cap, where `repo test packages` as one run does not.
 */
export function suiteChunks(root: string): string[] {
  const chunks: string[] = []
  for (const parent of SUITE_PARENTS) {
    let kids: string[] = []
    try {
      kids = readdirSync(join(root, parent), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const k of kids) if (hasTestFile(join(root, parent, k))) chunks.push(`${parent}/${k}`)
  }
  for (const s of SUITE_SINGLES) if (hasTestFile(join(root, s))) chunks.push(s)
  return chunks.sort()
}

/** Totals across chunk runs; a null count in any chunk makes that total unknown. */
export function sumRuns(runs: readonly TestRun[]): { pass: number | null; fail: number | null; skip: number | null; errors: number | null } {
  const add = (pick: (s: TestSummary) => number | null): number | null =>
    runs.reduce<number | null>((acc, r) => {
      const v = pick(r.summary)
      return acc === null || v === null ? null : acc + v
    }, 0)
  return { pass: add((s) => s.pass), fail: add((s) => s.fail), skip: add((s) => s.skip), errors: add((s) => s.errors) }
}

/**
 * `repo test --all`: the whole suite as one `bun test` run per chunk (see `suiteChunks`). Chunks queue on
 * the machine-wide test slots, so at most `slotCount()` run at once. Prints totals, then each failed
 * chunk with its own summary and log; an index log lists every chunk's counts and log.
 */
export async function runAllTests(root: string, timeout: string, io: Io, maxSeconds: number = DEFAULT_MAX_SECONDS, namePattern?: string): Promise<number> {
  const chunks = suiteChunks(root)
  if (chunks.length === 0) return io.fail("no test files found under packages/, apps/, tools/ or scripts/", "bun run repo test <paths…>")
  io.out(`running ${chunks.length} chunks, ${slotCount()} at a time (REPO_TEST_SLOTS overrides)`)
  const runs = await Promise.all(chunks.map((c) => execTests(root, [`./${c}`], timeout, "test-all", maxSeconds, namePattern)))
  const t = sumRuns(runs)
  const failed = runs.flatMap((r, i) => (r.failed ? [{ chunk: chunks[i] ?? "?", r }] : []))
  const index = newLogPath(root, "test-all-index")
  writeFileSync(
    index,
    runs.map((r, i) => `${chunks[i]}\t${r.failed ? "FAIL" : "ok"}\t${describeRun(r)[0] ?? ""}\t${r.log}`).join("\n") + "\n",
  )
  const indexRel = relative(root, index)
  const errors = t.errors !== null && t.errors > 0 ? `, ${t.errors} error` : ""
  const head = `${t.pass ?? "?"} pass, ${t.fail ?? "?"} fail, ${t.skip ?? "?"} skip${errors} across ${chunks.length} chunks`
  io.data({ ...t, chunks: runs.map((r, i) => ({ chunk: chunks[i], failed: r.failed, exit: r.exit, log: r.log, failures: r.summary.failures })), log: indexRel })
  if (failed.length === 0) {
    io.result(head)
    io.result(`log: ${indexRel}`)
    return 0
  }
  const lines = [head, `${failed.length} chunk(s) failed:`]
  for (const { chunk, r } of failed) {
    lines.push(`✗ ${chunk}`)
    for (const l of describeRun(r)) lines.push(`  ${l}`)
  }
  lines.push(`index: ${indexRel}`)
  return io.fail(lines.join("\n"), `bun run repo test ./${failed[0]?.chunk ?? "<chunk>"}`)
}

/** `repo test`: scoped bun test with a log file and a summary-only output. */
export const testCommand: Command = {
  name: "test",
  summary: "Run scoped bun tests; print summary, log full output",
  example: "bun run repo test tools/repo/tests",
  detail: [
    "<paths…>: test files or dirs, as for `bun test` (required unless --all)",
    "--all: full suite, one run per packages/<x>, apps/<x>, tools/<x> and scripts chunk, queued on the test slots; prints totals (pass/fail/skip/error) and each failed chunk. --max-seconds applies per chunk; give the Bash call timeout 600000",
    "-t <pattern>: only tests whose name matches (bun's test-name filter)",
    `--timeout <ms>: per-test timeout (default ${DEFAULT_TEST_TIMEOUT})`,
    `--max-seconds <n>: wall-clock limit for the whole run (default ${DEFAULT_MAX_SECONDS}); give the Bash call a matching timeout`,
    "output: counts, failing names, and error/expected/received/location for the first failures; the full log path last",
    "`N error` = unhandled errors outside any test (file load, between tests): the run fails and each is named `unhandled error in <file>: <message>`",
    "never pipe this or `bun test`: the log file holds the full output (Read it with offset/limit)",
    "concurrency: runs share max(2, cores/3) machine-wide slots (REPO_TEST_SLOTS overrides); extra runs print a waiting line and queue",
  ],
  async run(args, io) {
    const valueFlags = ["--timeout", "--root", "--max-seconds", "-t"]
    const { positionals: paths, flagTokens } = splitArgs(args, valueFlags)
    const bad = rejectUnknown(io, "test", flagTokens, { values: valueFlags, flags: ["--all"] })
    if (bad !== undefined) return bad
    const all = flagTokens.includes("--all")
    if (all && paths.length > 0) return io.usage("--all runs the whole suite; drop the paths or drop --all", "bun run repo test --all")
    if (!all && paths.length === 0) return io.usage("no test paths given (scoped tests only)", "bun run repo test <paths…>")
    const timeout = flagValue(args, "--timeout") ?? DEFAULT_TEST_TIMEOUT
    if (!/^\d+$/.test(timeout)) return io.usage(`--timeout must be milliseconds: ${timeout}`, "bun run repo test --help")
    const maxRaw = flagValue(args, "--max-seconds") ?? String(DEFAULT_MAX_SECONDS)
    if (!/^\d+$/.test(maxRaw) || Number(maxRaw) === 0) return io.usage(`--max-seconds must be a positive integer: ${maxRaw}`, "bun run repo test --help")
    const root = resolveRoot(flagValue(args, "--root"))
    if (all) return runAllTests(root, timeout, io, Number(maxRaw), flagValue(args, "-t"))
    return runScopedTests(root, paths, timeout, io, Number(maxRaw), flagValue(args, "-t"))
  },
}
