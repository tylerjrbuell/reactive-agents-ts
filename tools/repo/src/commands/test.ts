import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { summarizeBunTest, type TestSummary } from "../lib/bun-test-summary.ts"
import type { Io } from "../lib/output.ts"
import { resolveRoot } from "../lib/root.ts"

/** Failure names printed before `... N more`. */
const FAILURE_CAP = 15
/** Default per-test timeout passed to `bun test`. */
export const DEFAULT_TEST_TIMEOUT = "15000"

/** Path for a new log under `<root>/.repo-logs/`, creating the dir. */
export function newLogPath(root: string, prefix: string): string {
  const dir = join(root, ".repo-logs")
  mkdirSync(dir, { recursive: true })
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
}

/** Run `bun test <paths>` once with output going straight to a log file; no printing. */
export async function execTests(root: string, paths: readonly string[], timeout: string, logPrefix = "test", maxSeconds: number = DEFAULT_MAX_SECONDS): Promise<TestRun> {
  const log = newLogPath(root, logPrefix)
  const { code: exit, timedOut } = await spawnLogged("bun", ["test", ...paths, "--timeout", timeout], root, log, maxSeconds)
  const summary = summarizeBunTest(readFileSync(log, "utf8"))
  const failed = summary.fail === null || summary.fail > 0 || exit !== 0 || timedOut
  return { exit, summary, log: relative(root, log), failed, timedOut, maxSeconds }
}

/** Summary lines for a test run (counts, failure names capped, log path). */
export function describeRun(r: TestRun): string[] {
  const s = r.summary
  const msg: string[] = [`${s.pass ?? "?"} pass, ${s.fail ?? "?"} fail, ${s.skip ?? "?"} skip`]
  if (r.timedOut) msg.push(`fail: timeout after ${r.maxSeconds}s`)
  if (s.fail === null) msg.push("fail: unknown")
  if (s.fail === null && r.exit !== 0) msg.push(`bun test exited ${r.exit}`)
  for (const f of s.failures.slice(0, FAILURE_CAP)) msg.push(`  ${f}`)
  if (s.failures.length > FAILURE_CAP) msg.push(`  ... ${s.failures.length - FAILURE_CAP} more`)
  msg.push(`log: ${r.log}`)
  return msg
}

/** Run scoped tests and print the summary through `io`. Shared entry for `repo test`. Returns exit code. */
export async function runScopedTests(root: string, paths: readonly string[], timeout: string, io: Io, maxSeconds: number = DEFAULT_MAX_SECONDS): Promise<number> {
  const r = await execTests(root, paths, timeout, "test", maxSeconds)
  const s = r.summary
  io.data({ pass: s.pass, fail: s.fail, skip: s.skip, failures: s.failures, exit: r.exit, log: r.log })
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
  async run(args, io) {
    const { positionals: paths, flagTokens } = splitArgs(args, ["--timeout", "--root", "--max-seconds"])
    const bad = rejectUnknown(io, "test", flagTokens, { values: ["--timeout", "--root", "--max-seconds"] })
    if (bad !== undefined) return bad
    if (paths.length === 0) return io.usage("no test paths given (scoped tests only)", "bun run repo test <paths…>")
    const timeout = flagValue(args, "--timeout") ?? DEFAULT_TEST_TIMEOUT
    if (!/^\d+$/.test(timeout)) return io.usage(`--timeout must be milliseconds: ${timeout}`, "bun run repo test --help")
    const maxRaw = flagValue(args, "--max-seconds") ?? String(DEFAULT_MAX_SECONDS)
    if (!/^\d+$/.test(maxRaw) || Number(maxRaw) === 0) return io.usage(`--max-seconds must be a positive integer: ${maxRaw}`, "bun run repo test --help")
    const root = resolveRoot(flagValue(args, "--root"))
    return runScopedTests(root, paths, timeout, io, Number(maxRaw))
  },
}
