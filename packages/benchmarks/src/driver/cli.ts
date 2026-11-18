// File: src/driver/cli.ts — `bun run bench:drive -- <spec.json>` | status <dir> | stop <dir>.
//
// `start` writes the state file and spawns THIS file as a detached supervisor
// (`_supervise`, own session and process group, stdio to supervisor.log) and
// returns at once: the run survives the parent shell. The supervisor runs the
// run-h3 chunks as children in its group, so `stop` is one group kill.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { checkContention } from "../preflight-provenance.js"
import {
  formatStatus, makeStore, newState, parseSpec, planUnits, readState, runDriver, writeState,
  type DriveSpec, type DriverDeps,
} from "./driver.js"

const SELF = fileURLToPath(import.meta.url)

export const pidAlive = (pid: number | null): boolean => {
  if (pid === null) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return typeof e === "object" && e !== null && "code" in e && e.code === "EPERM"
  }
}

/** Real chunk runner: child in the supervisor's own process group, output appended to the log. */
export const realDeps = (): DriverDeps => ({
  spawnChunk: ({ argv, env, logPath }) =>
    new Promise((resolve) => {
      mkdirSync(join(logPath, ".."), { recursive: true })
      const fd = openSync(logPath, "a")
      const [cmd, ...args] = argv
      const child = spawn(cmd!, args, { env: { ...process.env, ...env }, stdio: ["ignore", fd, fd] })
      const done = (code: number | null): void => {
        closeSync(fd)
        resolve({ code })
      }
      child.on("error", () => done(null))
      child.on("close", done)
    }),
  preflight: async (models) => {
    const r = await checkContention(models)
    return { ok: r.ok, findings: r.findings }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
})

/** Start (or resume) a drive. Returns a message; `error` set when nothing started. */
export function startDrive(spec: DriveSpec): { readonly message: string; readonly error?: true } {
  const prior = readState(spec.outDir)
  if (prior && pidAlive(prior.pid)) return { message: `already running (supervisor pid ${prior.pid}); use status/stop`, error: true }
  const planned = planUnits(spec).map((u) => u.id)
  if (prior && JSON.stringify(prior.order) !== JSON.stringify(planned)) {
    return { message: `${spec.outDir} holds a different plan (task/tier/arm/k set differs); use a fresh outDir`, error: true }
  }
  mkdirSync(spec.outDir, { recursive: true })
  const base = prior ?? newState(spec)
  writeState({ ...base, spec, status: "starting", pid: null, updatedAt: new Date().toISOString() })
  const fd = openSync(join(spec.outDir, "supervisor.log"), "a")
  const child = spawn(process.execPath, [SELF, "_supervise", spec.outDir], { detached: true, stdio: ["ignore", fd, fd], env: process.env })
  child.unref()
  closeSync(fd)
  return { message: `${prior ? "resumed" : "started"}: supervisor pid ${child.pid}, outDir ${spec.outDir}\n  bench:drive status ${spec.outDir}\n  bench:drive stop ${spec.outDir}` }
}

/** Kill the supervisor's whole process group (children included); SIGKILL after `graceMs`. */
export async function stopDrive(outDir: string, graceMs = 8000): Promise<string> {
  const state = readState(outDir)
  if (!state) return `no state file in ${outDir}`
  const pid = state.pid
  if (pid === null || !pidAlive(pid)) {
    if (state.status === "running" || state.status === "paused" || state.status === "starting") writeState({ ...state, status: "stopped", pid: null, current: null })
    return "not running"
  }
  try { process.kill(-pid, "SIGTERM") } catch { /* group gone */ }
  const until = Date.now() + graceMs
  while (pidAlive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100))
  const killed = pidAlive(pid)
  if (killed) try { process.kill(-pid, "SIGKILL") } catch { /* gone */ }
  const after = readState(outDir)
  if (after && (after.status === "running" || after.status === "paused" || after.status === "starting")) writeState({ ...after, status: "stopped", pid: null, current: null })
  return `stopped supervisor group ${pid}${killed ? " (SIGKILL after grace)" : ""}; in-flight cell is re-run on resume`
}

async function supervise(outDir: string): Promise<number> {
  const state = readState(outDir)
  if (!state) return 2
  const store = makeStore({ ...state, pid: process.pid })
  store.commit({ status: "running" })
  const onStop = (): never => {
    store.commit({ status: "stopped", pid: null, current: null })
    process.exit(143)
  }
  process.on("SIGTERM", onStop)
  process.on("SIGINT", onStop)
  const status = await runDriver(store, realDeps())
  store.commit({ pid: null })
  console.error(`[drive] ${status}`)
  return 0
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((a) => a !== "--")
  const [cmd, target] = args
  if (cmd === "_supervise" && target) process.exit(await supervise(target))
  if (cmd === "status" && target) {
    const s = readState(target)
    if (!s) { console.error(`no state file in ${target}`); process.exit(2) }
    console.log(formatStatus(s, pidAlive(s.pid)))
    process.exit(0)
  }
  if (cmd === "stop" && target) {
    console.log(await stopDrive(target))
    process.exit(0)
  }
  if (!cmd || !existsSync(cmd)) {
    console.error("usage: bench:drive <spec.json> | status <outDir> | stop <outDir>\n  spec: {outDir(abs), tiers[], arms[{id,env?,noSwitch?,metaArm?}], k, tasks?[], suite?, cellTimeoutSec?, env?, allowContention?, verdict?{before,after,reason,mechanism?}}")
    process.exit(2)
  }
  const { H3_TASKS } = await import("../h3/tasks.js")
  const { LH_TASKS } = await import("../h3/long-horizon-tasks.js")
  let raw: unknown
  try { raw = JSON.parse(readFileSync(cmd, "utf8")) } catch (e) { console.error(`spec: not valid JSON (${String(e)})`); process.exit(2) }
  const spec = parseSpec(raw, (suite) => (suite === "long-horizon" ? LH_TASKS : H3_TASKS).map((t) => t.id))
  if (typeof spec === "string") { console.error(spec); process.exit(2) }
  const r = startDrive(spec)
  console.log(r.message)
  process.exit(r.error ? 2 : 0)
}
