import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { summarizeBunTest } from "../lib/bun-test-summary.ts"
import { orderJobs, planFromWorkflow, stepKey, type CiJob, type CiPlan, type CiSkip, type CiStep } from "../lib/ci-plan.ts"
import type { Io } from "../lib/output.ts"
import { resolveRoot } from "../lib/root.ts"
import { acquireSlot, pidAlive, SLOT_HELD_ENV } from "../lib/test-slots.ts"
import { preflightHeavy, PRESSURE_HINT, pressureStop } from "./janitor.ts"
import { describeRun, spawnLogged, suiteChunks } from "./test.ts"

/** Workflow the mirror reads. */
export const WORKFLOW = ".github/workflows/ci.yml"
/** Per-step wall-clock limit, seconds (the root `bun test` is the long one). */
const DEFAULT_STEP_SECONDS = 1800
/** Ollama address that refuses connections, so Ollama-gated tests skip as they do on the runner. */
export const UNREACHABLE_OLLAMA = "http://127.0.0.1:9"
/** Host env vars passed through to steps; everything else (API keys, tokens, agent/session vars) is dropped. */
const PASS_ENV = ["PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TZ"] as const
/** Newest `ci-*` log dirs kept under `.repo-logs/`. */
const LOG_DIRS_KEPT = 5
/** Commit SHAs that passed a full `repo ci`; the pre-push hook skips them. */
export const VERIFIED_LOG = ".repo-logs/ci-verified.jsonl"
/** Lines of a failed non-test step's log shown inline. */
const TAIL_LINES = 12
/** Steps `--fast` keeps, in plan order; `bun test` becomes `bun test <changed chunks>`. */
const FAST_STEPS = [/^bun install(\s|$)/, /^bun run build$/, /^bun run typecheck$/, /^bun run repo check --all$/, /^bun test$/]

/**
 * The step environment: a short host allowlist plus what a GitHub runner sets. No `.env` keys,
 * no `*_API_KEY`, no agent or session variables, a throwaway HOME (no global git excludes or
 * tool config), a disk TMPDIR, and Ollama pointed at a closed port. The bun install cache is the
 * host's, as CI restores its own cache (packages only, no repo state).
 */
export function ciEnv(
  host: Readonly<Record<string, string | undefined>>,
  dirs: { home: string; tmp: string; github: string },
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const k of PASS_ENV) {
    const v = host[k]
    if (v !== undefined) env[k] = v
  }
  return {
    ...env,
    HOME: dirs.home,
    TMPDIR: dirs.tmp,
    CI: "true",
    GITHUB_ACTIONS: "true",
    OLLAMA_HOST: UNREACHABLE_OLLAMA,
    BUN_INSTALL_CACHE_DIR: host.BUN_INSTALL_CACHE_DIR ?? join(host.HOME ?? homedir(), ".bun", "install", "cache"),
    GITHUB_STEP_SUMMARY: join(dirs.github, "step-summary.md"),
    GITHUB_OUTPUT: join(dirs.github, "output"),
    GITHUB_ENV: join(dirs.github, "env"),
    // The run holds one machine-wide test slot; nested `repo test` calls inside the suite must not wait on it.
    [SLOT_HELD_ENV]: "1",
  }
}

/** Mode of a run: the whole mirror, the documented-weaker fast subset, or one command after install. */
export type CiMode = { kind: "full"; only?: string } | { kind: "fast"; testDirs: readonly string[] } | { kind: "run"; command: string }

/** A planned item: a step to run or a ci.yml step that is skipped. */
export type CiItem = { step: CiStep } | { skip: CiSkip }

/**
 * Ordered items for `mode`. Throws on an unknown `--only` job or when the plan lacks a step the mode needs.
 */
export function selectSteps(plan: CiPlan, mode: CiMode): CiItem[] {
  const ordered = orderJobs(plan.jobs)
  if (mode.kind === "full") {
    const jobs = mode.only === undefined ? ordered : ordered.filter((j) => j.id === mode.only)
    if (jobs.length === 0) throw new Error(`no job ${mode.only} in ${WORKFLOW} (jobs: ${plan.jobs.map((j) => j.id).join(", ")})`)
    return jobs.flatMap((j: CiJob): CiItem[] => [...j.steps.map((step) => ({ step })), ...j.skipped.map((skip) => ({ skip }))])
  }
  const all = ordered.flatMap((j) => j.steps)
  const install = all.find((s) => FAST_STEPS[0]?.test(s.run) === true)
  if (install === undefined) throw new Error(`${WORKFLOW} has no bun install step`)
  if (mode.kind === "run") return [{ step: { ...install, job: "run" } }, { step: { job: "run", name: mode.command, run: mode.command, env: {} } }]
  const items: CiItem[] = []
  for (const re of FAST_STEPS) {
    const s = all.find((x) => x.cwd === undefined && re.test(x.run))
    if (s === undefined) throw new Error(`${WORKFLOW} has no step matching ${re} for --fast`)
    if (s.run !== "bun test") items.push({ step: { ...s, job: "fast" } })
    else if (mode.testDirs.length === 0) items.push({ skip: { job: "fast", name: "bun test", reason: "no changed package with tests" } })
    else items.push({ step: { ...s, job: "fast", name: `bun test (changed: ${mode.testDirs.join(" ")})`, run: `bun test ${mode.testDirs.map((d) => `./${d}`).join(" ")}` } })
  }
  return items
}

/** Suite chunks (`packages/<x>`, `tools/<x>`, ...) that contain a changed path. */
export function changedChunks(changed: readonly string[], chunks: readonly string[]): string[] {
  return chunks.filter((c) => changed.some((p) => p === c || p.startsWith(`${c}/`)))
}

const fmt = (ms: number): string => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/** Base dir for clones: `REPO_CI_DIR`, else `$XDG_CACHE_HOME/repo-ci` or `~/.cache/repo-ci` (on disk, outside the repo). */
function cloneBase(env: Readonly<Record<string, string | undefined>>): string {
  if (env.REPO_CI_DIR !== undefined && env.REPO_CI_DIR.length > 0) return env.REPO_CI_DIR
  return join(env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "repo-ci")
}

/** Remove run dirs left by a `repo ci` that died without cleanup (its PID is gone). */
function removeStale(base: string, prefix: string): void {
  try {
    for (const d of readdirSync(base)) {
      const m = new RegExp(`^${prefix.replace(/[^\w-]/g, "\\$&")}-(\\d+)$`).exec(d)
      if (m !== null && !pidAlive(Number(m[1]))) rmSync(join(base, d), { recursive: true, force: true })
    }
  } catch {
    // Nothing to clean.
  }
}

function pruneLogDirs(dir: string): void {
  try {
    const old = readdirSync(dir)
      .filter((f) => f.startsWith("ci-") && statSync(join(dir, f)).isDirectory())
      .sort()
      .reverse()
      .slice(LOG_DIRS_KEPT - 1)
    for (const f of old) rmSync(join(dir, f), { recursive: true, force: true })
  } catch {
    // Rotation never fails a run.
  }
}

function tail(path: string, n: number): string[] {
  try {
    return readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).slice(-n)
  } catch {
    return []
  }
}

/** Changed paths between the upstream merge-base and `sha` (for `--fast`). */
function changedSince(root: string, sha: string): string[] {
  for (const ref of ["@{upstream}", "origin/dev", "origin/main"]) {
    try {
      const base = git(root, ["merge-base", sha, ref])
      return git(root, ["diff", "--name-only", base, sha]).split("\n").filter((l) => l.length > 0)
    } catch {
      // Try the next base.
    }
  }
  throw new Error("--fast: no upstream, origin/dev or origin/main to diff against")
}

/** Step result. */
interface StepResult {
  ok: boolean
  ms: number
  log: string
}

/** `repo ci`: run CI's own steps (from ci.yml) on a fresh local clone of a commit, with a CI-like env. */
export const ciCommand: Command = {
  name: "ci",
  summary: "Mirror CI (ci.yml) on a fresh local clone of HEAD with a CI-like env",
  example: "bun run repo ci --dry-run",
  detail: [
    `Reads ${WORKFLOW}; every step runs or is skipped with a printed reason; an unmappable step fails the run.`,
    "Runs in a `git clone --local` of the commit (committed state only: no .env, no untracked or ignored files),",
    `env: host PATH/locale only, CI=true, temp HOME and TMPDIR, OLLAMA_HOST=${UNREACHABLE_OLLAMA}, no API keys. The clone is removed on exit.`,
    "Jobs share the clone: jobs without a root build run first, shared steps (install, build) run once.",
    "--only <job>: one ci.yml job (typecheck, test, docs-gates, docs-links)",
    "--fast: install, build, typecheck, check --all and bun test for changed packages only. WEAKER than CI: no root suite, no docs gates",
    "--run <cmd>: install, then only <cmd> in the CI-like clone (reproduce one failure: --run 'bun test path/x.test.ts')",
    "--rev <rev>: commit to mirror (default HEAD); --max-seconds <n>: per-step limit (default 1800); --dry-run: print the plan",
    `A full passing run records the commit in ${VERIFIED_LOG}; the pre-push hook skips commits already recorded.`,
    "Memory is re-checked before each step: when the guard refuses, no further step starts and the run fails (not recorded as verified).",
    "Logs: .repo-logs/ci-<time>/ (one per step). Takes a machine-wide test slot. Run it in a terminal or a background task: a full run exceeds 10 min.",
  ],
  async run(args, io) {
    const values = ["--only", "--run", "--rev", "--max-seconds", "--root"]
    const { positionals, flagTokens } = splitArgs(args, values)
    const bad = rejectUnknown(io, "ci", [...flagTokens, ...positionals], { flags: ["--fast", "--dry-run"], values })
    if (bad !== undefined) return bad
    const only = flagValue(args, "--only")
    const runCmd = flagValue(args, "--run")
    const fast = flagTokens.includes("--fast")
    if ([only !== undefined, runCmd !== undefined, fast].filter(Boolean).length > 1)
      return io.usage("--only, --fast and --run are exclusive", "bun run repo ci --help")
    const maxRaw = flagValue(args, "--max-seconds") ?? String(DEFAULT_STEP_SECONDS)
    if (!/^\d+$/.test(maxRaw) || Number(maxRaw) === 0) return io.usage(`--max-seconds must be a positive integer: ${maxRaw}`, "bun run repo ci --help")
    const root = resolveRoot(flagValue(args, "--root"))
    const rev = flagValue(args, "--rev") ?? "HEAD"

    let sha: string
    try {
      sha = git(root, ["rev-parse", "--verify", `${rev}^{commit}`])
    } catch {
      return io.usage(`not a commit: ${rev}`, "bun run repo ci --rev <commit>")
    }
    const workflowText = git(root, ["show", `${sha}:${WORKFLOW}`])
    let plan: CiPlan
    try {
      plan = planFromWorkflow(workflowText)
    } catch (e) {
      return io.fail(`ci mirror cannot map ${WORKFLOW}: ${e instanceof Error ? e.message : String(e)}`, "edit tools/repo/src/lib/ci-plan.ts")
    }
    const short = sha.slice(0, 9)
    const modeLabel = fast ? "fast (WEAKER than CI)" : runCmd !== undefined ? "run" : only !== undefined ? `job ${only}` : "full"

    const refused = args.includes("--dry-run") ? undefined : preflightHeavy(io, "repo ci")
    if (refused !== undefined) return refused

    const base = cloneBase(process.env)
    const prefix = basename(root)
    const runDir = join(base, `${prefix}-${process.pid}`)
    const clone = join(runDir, "repo")
    const preview = (mode: CiMode): CiItem[] | number => {
      try {
        return selectSteps(plan, mode)
      } catch (e) {
        return io.usage(e instanceof Error ? e.message : String(e), "bun run repo ci --help")
      }
    }
    if (args.includes("--dry-run")) {
      const items = preview(fast ? { kind: "fast", testDirs: ["<changed>"] } : runCmd !== undefined ? { kind: "run", command: runCmd } : { kind: "full", ...(only !== undefined ? { only } : {}) })
      if (typeof items === "number") return items
      io.data({ sha, mode: modeLabel, items })
      io.result(`ci ${modeLabel} on ${short}, clone under ${base}`)
      for (const it of items) io.result("step" in it ? `  ${it.step.job} · ${it.step.cwd !== undefined ? `(${it.step.cwd}) ` : ""}${it.step.run.split("\n")[0]}` : `  ${it.skip.job} · ${it.skip.name}: skipped (${it.skip.reason})`)
      return 0
    }

    const started = Date.now()
    const slot = await acquireSlot((l) => void io.result(l))
    removeStale(base, prefix)
    const cleanup = (): void => rmSync(runDir, { recursive: true, force: true })
    const onSignal = (sig: NodeJS.Signals): void => {
      cleanup()
      slot.release()
      process.exit(sig === "SIGINT" ? 130 : 143)
    }
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)
    try {
      const dirs = { home: join(runDir, "home"), tmp: join(runDir, "tmp"), github: join(runDir, "github") }
      for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true })
      // --local hardlinks objects; the clone has its own .git, so `git rev-parse --git-common-dir` can never reach this checkout's .env.
      execFileSync("git", ["clone", "--quiet", "--local", "--no-checkout", root, clone], { stdio: ["ignore", "pipe", "pipe"] })
      git(clone, ["checkout", "--quiet", "--detach", sha])
      const mode: CiMode = fast
        ? { kind: "fast", testDirs: changedChunks(changedSince(root, sha), suiteChunks(clone)) }
        : runCmd !== undefined
          ? { kind: "run", command: runCmd }
          : { kind: "full", ...(only !== undefined ? { only } : {}) }
      const items = preview(mode)
      if (typeof items === "number") return items

      const logRoot = join(root, ".repo-logs")
      mkdirSync(logRoot, { recursive: true })
      pruneLogDirs(logRoot)
      const logDir = join(logRoot, `ci-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`)
      mkdirSync(logDir)
      const env = ciEnv(process.env, dirs)

      io.result(`ci ${modeLabel} on ${short} (clone ${clone})`)
      const bunWant = plan.bunVersion
      if (bunWant !== undefined && bunWant !== "latest" && Bun.version !== bunWant) io.result(`warn: local bun ${Bun.version}, CI pins ${bunWant}`)
      const nodeV = spawnSync("node", ["--version"], { encoding: "utf8" }).stdout?.trim() ?? ""
      if (plan.nodeVersion !== undefined && !nodeV.startsWith(`v${plan.nodeVersion}`)) io.result(`warn: local node ${nodeV || "missing"}, CI uses ${plan.nodeVersion}`)

      const done = new Map<string, StepResult>()
      const failedJobs = new Set<string>()
      const rows: { job: string; name: string; status: "pass" | "fail" | "not-run" | "skip" | "shared"; seconds?: number; log?: string; reason?: string }[] = []
      let firstFailLog: string | undefined
      let n = 0
      // Re-checked before each step: a long run that grows into memory pressure stops scheduling steps.
      let stopReason: string | undefined
      let stopPrinted = false
      for (const it of items) {
        if ("skip" in it) {
          rows.push({ job: it.skip.job, name: it.skip.name, status: "skip", reason: it.skip.reason })
          io.result(`- ${it.skip.job} · ${it.skip.name}: skipped (${it.skip.reason})`)
          continue
        }
        const s = it.step
        if (failedJobs.has(s.job)) {
          rows.push({ job: s.job, name: s.name, status: "not-run" })
          continue
        }
        const key = stepKey(s)
        const prior = done.get(key)
        if (prior !== undefined) {
          rows.push({ job: s.job, name: s.name, status: "shared", log: prior.log })
          if (!prior.ok) failedJobs.add(s.job)
          continue
        }
        stopReason ??= pressureStop()
        if (stopReason !== undefined) {
          if (!stopPrinted) io.result(`memory guard: ${stopReason}; starting no more steps`)
          stopPrinted = true
          rows.push({ job: s.job, name: s.name, status: "not-run", reason: "memory guard" })
          continue
        }
        n += 1
        const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
        const logPath = join(logDir, `${String(n).padStart(2, "0")}-${s.job}-${slug}.log`)
        const t0 = Date.now()
        const r = await spawnLogged("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", s.run], join(clone, s.cwd ?? "."), logPath, Number(maxRaw), s.env, env)
        const ms = Date.now() - t0
        const log = relative(root, logPath)
        const ok = r.code === 0 && !r.timedOut
        done.set(key, { ok, ms, log })
        rows.push({ job: s.job, name: s.name, status: ok ? "pass" : "fail", seconds: Math.round(ms / 1000), log })
        if (ok) {
          io.result(`✓ ${s.job} · ${s.name} (${fmt(ms)})`)
          continue
        }
        failedJobs.add(s.job)
        firstFailLog ??= log
        io.result(`✗ ${s.job} · ${s.name} (${fmt(ms)})${r.timedOut ? ` timeout after ${maxRaw}s` : ""}`)
        if (/^bun test(\s|$)/.test(s.run)) {
          const summary = summarizeBunTest(readFileSync(logPath, "utf8"))
          for (const l of describeRun({ exit: r.code, summary, log, failed: true, timedOut: r.timedOut, maxSeconds: Number(maxRaw), root: clone })) io.result(`    ${l}`)
        } else {
          for (const l of tail(logPath, TAIL_LINES)) io.result(`    ${l}`)
          io.result(`    log: ${log}`)
        }
      }

      const count = (st: string): number => rows.filter((r) => r.status === st).length
      const elapsed = fmt(Date.now() - started)
      const line = `ci ${modeLabel} ${short}: ${count("pass")} passed, ${count("fail")} failed, ${count("not-run")} not run, ${count("skip")} skipped in ${elapsed} (logs: ${relative(root, logDir)})`
      io.data({ sha, mode: modeLabel, steps: rows, elapsed, logDir: relative(root, logDir) })
      if (failedJobs.size > 0) return io.fail(line, `open ${firstFailLog ?? relative(root, logDir)}`)
      if (stopReason !== undefined) return io.fail(`${line}; stopped by the memory guard (${stopReason})`, PRESSURE_HINT)
      if (mode.kind === "full" && mode.only === undefined) {
        appendFileSync(join(root, VERIFIED_LOG), `${JSON.stringify({ sha, ts: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) })}\n`)
      }
      io.result(line)
      return 0
    } finally {
      process.off("SIGINT", onSignal)
      process.off("SIGTERM", onSignal)
      cleanup()
      slot.release()
    }
  },
}
