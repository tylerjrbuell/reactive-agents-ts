import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
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
  return join(dir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`)
}

/** Run a command with stdout+stderr sent straight to `logPath` (no pipe). Resolves with the exit code. */
export function spawnLogged(cmd: string, args: readonly string[], cwd: string, logPath: string): Promise<number> {
  const fd = openSync(logPath, "w")
  return new Promise((done) => {
    const child = spawn(cmd, [...args], { cwd, stdio: ["ignore", fd, fd] })
    child.on("close", (code) => {
      closeSync(fd)
      done(code ?? 1)
    })
    child.on("error", () => {
      closeSync(fd)
      done(1)
    })
  })
}

/** Result of one logged `bun test` run. */
export interface TestRun {
  exit: number
  summary: TestSummary
  /** Repo-relative log path. */
  log: string
  failed: boolean
}

/** Run `bun test <paths>` once with output going straight to a log file; no printing. */
export async function execTests(root: string, paths: readonly string[], timeout: string, logPrefix = "test"): Promise<TestRun> {
  const log = newLogPath(root, logPrefix)
  const exit = await spawnLogged("bun", ["test", ...paths, "--timeout", timeout], root, log)
  const summary = summarizeBunTest(readFileSync(log, "utf8"))
  const failed = summary.fail === null || summary.fail > 0 || exit !== 0
  return { exit, summary, log: relative(root, log), failed }
}

/** Summary lines for a test run (counts, failure names capped, log path). */
export function describeRun(r: TestRun): string[] {
  const s = r.summary
  const msg: string[] = [`${s.pass ?? "?"} pass, ${s.fail ?? "?"} fail, ${s.skip ?? "?"} skip`]
  if (s.fail === null) msg.push("fail: unknown")
  if (s.fail === null && r.exit !== 0) msg.push(`bun test exited ${r.exit}`)
  for (const f of s.failures.slice(0, FAILURE_CAP)) msg.push(`  ${f}`)
  if (s.failures.length > FAILURE_CAP) msg.push(`  ... ${s.failures.length - FAILURE_CAP} more`)
  msg.push(`log: ${r.log}`)
  return msg
}

/** Run scoped tests and print the summary through `io`. Shared entry for `repo test`. Returns exit code. */
export async function runScopedTests(root: string, paths: readonly string[], timeout: string, io: Io): Promise<number> {
  const r = await execTests(root, paths, timeout)
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
    const flagged = args.filter((a, i) => a.startsWith("-") || args[i - 1] === "--timeout" || args[i - 1] === "--root")
    const paths = args.filter((a) => !flagged.includes(a))
    const bad = rejectUnknown(io, "test", flagged, { values: ["--timeout", "--root"] })
    if (bad !== undefined) return bad
    if (paths.length === 0) return io.usage("no test paths given (scoped tests only)", "bun run repo test <paths…>")
    const timeout = flagValue(args, "--timeout") ?? DEFAULT_TEST_TIMEOUT
    if (!/^\d+$/.test(timeout)) return io.usage(`--timeout must be milliseconds: ${timeout}`, "bun run repo test --help")
    const root = resolveRoot(flagValue(args, "--root"))
    return runScopedTests(root, paths, timeout, io)
  },
}
