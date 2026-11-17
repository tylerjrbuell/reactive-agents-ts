import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { summarizeBunTest, type TestSummary } from "../lib/bun-test-summary.ts"
import type { Io } from "../lib/output.ts"
import { resolveRoot } from "../lib/root.ts"

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
): Promise<{ code: number; timedOut: boolean }> {
  const fd = openSync(logPath, "w")
  return new Promise((done) => {
    const child = spawn(cmd, [...args], {
      cwd,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
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
 * Run `bun test <paths>` once with output going straight to a log file; no printing.
 * `namePattern` is passed as `-t <pattern>` (bun's test-name filter).
 */
export async function execTests(
  root: string,
  paths: readonly string[],
  timeout: string,
  logPrefix = "test",
  maxSeconds: number = DEFAULT_MAX_SECONDS,
  namePattern?: string,
): Promise<TestRun> {
  const log = newLogPath(root, logPrefix)
  const filter = namePattern === undefined ? [] : ["-t", namePattern]
  const { code: exit, timedOut } = await spawnLogged("bun", ["test", ...paths, "--timeout", timeout, ...filter], root, log, maxSeconds)
  const summary = summarizeBunTest(readFileSync(log, "utf8"))
  const failed = summary.fail === null || summary.fail > 0 || exit !== 0 || timedOut
  return { exit, summary, log: relative(root, log), failed, timedOut, maxSeconds, root }
}

/** Summary lines for a test run (counts, failure names capped with error excerpts for the first few, log path). */
export function describeRun(r: TestRun): string[] {
  const s = r.summary
  // A timeout has no meaningful counts: say only that, plus the log.
  if (r.timedOut) return [`fail: timeout after ${r.maxSeconds}s`, `log: ${r.log}`]
  const msg: string[] = [`${s.pass ?? "?"} pass, ${s.fail ?? "?"} fail, ${s.skip ?? "?"} skip`]
  if (s.fail === null) msg.push("fail: unknown")
  if (s.fail === null && r.exit !== 0) msg.push(`bun test exited ${r.exit}`)
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
  const r = await execTests(root, paths, timeout, "test", maxSeconds, namePattern)
  const s = r.summary
  io.data({ pass: s.pass, fail: s.fail, skip: s.skip, failures: s.failures, details: s.details, exit: r.exit, log: r.log })
  const lines = describeRun(r)
  if (!r.failed) {
    for (const l of lines) io.result(l)
    return 0
  }
  return io.fail(lines.join("\n"), `open ${r.log}`)
}

/** `repo test`: scoped bun test with a log file and a summary-only output. */
export const testCommand: Command = {
  name: "test",
  summary: "Run scoped bun tests; print summary, log full output",
  example: "bun run repo test tools/repo/tests",
  detail: [
    "<paths…>: test files or dirs, as for `bun test` (required: scoped tests only)",
    "-t <pattern>: only tests whose name matches (bun's test-name filter)",
    `--timeout <ms>: per-test timeout (default ${DEFAULT_TEST_TIMEOUT})`,
    `--max-seconds <n>: wall-clock limit for the whole run (default ${DEFAULT_MAX_SECONDS}); give the Bash call a matching timeout`,
    "output: counts, failing names, and error/expected/received/location for the first failures; the full log path last",
    "never pipe this or `bun test`: the log file holds the full output (Read it with offset/limit)",
  ],
  async run(args, io) {
    const valueFlags = ["--timeout", "--root", "--max-seconds", "-t"]
    const { positionals: paths, flagTokens } = splitArgs(args, valueFlags)
    const bad = rejectUnknown(io, "test", flagTokens, { values: valueFlags })
    if (bad !== undefined) return bad
    if (paths.length === 0) return io.usage("no test paths given (scoped tests only)", "bun run repo test <paths…>")
    const timeout = flagValue(args, "--timeout") ?? DEFAULT_TEST_TIMEOUT
    if (!/^\d+$/.test(timeout)) return io.usage(`--timeout must be milliseconds: ${timeout}`, "bun run repo test --help")
    const maxRaw = flagValue(args, "--max-seconds") ?? String(DEFAULT_MAX_SECONDS)
    if (!/^\d+$/.test(maxRaw) || Number(maxRaw) === 0) return io.usage(`--max-seconds must be a positive integer: ${maxRaw}`, "bun run repo test --help")
    const root = resolveRoot(flagValue(args, "--root"))
    return runScopedTests(root, paths, timeout, io, Number(maxRaw), flagValue(args, "-t"))
  },
}
