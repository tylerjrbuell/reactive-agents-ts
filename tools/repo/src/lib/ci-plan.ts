import { parse } from "yaml"

/**
 * Turn `.github/workflows/ci.yml` into the step list `repo ci` runs locally, so ci.yml stays the
 * single source of what CI checks. Every step is either mapped to a local `run`, or skipped with a
 * stated reason, or rejected: a step this file does not know how to mirror throws, so a new CI step
 * can never be silently left out of the local mirror.
 */

/** One shell step to run in the clone. */
export interface CiStep {
  job: string
  name: string
  run: string
  /** Repo-relative working directory (`working-directory`), if any. */
  cwd?: string
  env: Readonly<Record<string, string>>
}

/** A ci.yml step the mirror does not run, and why. */
export interface CiSkip {
  job: string
  name: string
  reason: string
}

/** A job: its runnable steps and its skipped ones, in ci.yml order. */
export interface CiJob {
  id: string
  name: string
  steps: readonly CiStep[]
  skipped: readonly CiSkip[]
}

/** The mirror plan plus the toolchain versions CI pins. */
export interface CiPlan {
  jobs: readonly CiJob[]
  bunVersion?: string
  nodeVersion?: string
}

/** Actions whose effect the mirror reproduces itself (no step runs for them). */
const HANDLED_ACTIONS: Readonly<Record<string, string>> = {
  "actions/checkout": "fresh local clone of the commit",
  "actions/setup-node": "local node (version compared)",
  "oven-sh/setup-bun": "local bun (version compared)",
  "actions/cache": "local bun install cache",
}

/** Actions that cannot run locally: the step is skipped with this reason and shown in the summary. */
const SKIPPED_ACTIONS: Readonly<Record<string, string>> = {
  "lycheeverse/lychee-action": "network link check (lychee action), CI only",
}

/** `if:` conditions the mirror understands. A local run mirrors a push, so PR-only steps are skipped. */
const PR_ONLY = /^\$?\{?\{?\s*github\.event_name\s*==\s*'pull_request'\s*\}?\}?$/

/** Job and workflow keys that would change how steps run; the mirror rejects them rather than ignore them. */
const UNSUPPORTED_JOB_KEYS = ["defaults", "env", "services", "strategy", "container", "needs", "if"]

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)

function strMap(v: unknown, where: string): Record<string, string> {
  if (v === undefined) return {}
  if (!isObj(v)) throw new Error(`${where}: env must be a mapping`)
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    const s = String(val)
    if (s.includes("${{")) throw new Error(`${where}: env ${k} uses a GitHub expression the mirror cannot evaluate`)
    out[k] = s
  }
  return out
}

/**
 * Parse ci.yml text into a plan. Throws with the job and step name on anything unmappable:
 * an unknown action, an unknown `if:`, a non-bash `shell:`, a `${{ }}` expression in a run step,
 * or a job/workflow key that changes execution (env, defaults, services, matrix, needs).
 */
export function planFromWorkflow(text: string): CiPlan {
  const doc: unknown = parse(text)
  if (!isObj(doc) || !isObj(doc.jobs)) throw new Error("ci.yml: no jobs mapping")
  for (const k of ["env", "defaults"]) if (k in doc) throw new Error(`ci.yml: workflow-level ${k} is not mirrored; teach tools/repo/src/lib/ci-plan.ts`)
  let bunVersion: string | undefined
  let nodeVersion: string | undefined
  const jobs: CiJob[] = []
  for (const [id, raw] of Object.entries(doc.jobs)) {
    if (!isObj(raw) || !Array.isArray(raw.steps)) throw new Error(`ci.yml job ${id}: no steps`)
    for (const k of UNSUPPORTED_JOB_KEYS)
      if (k in raw) throw new Error(`ci.yml job ${id}: job-level ${k} is not mirrored; teach tools/repo/src/lib/ci-plan.ts`)
    const jobName = typeof raw.name === "string" ? raw.name : id
    const steps: CiStep[] = []
    const skipped: CiSkip[] = []
    raw.steps.forEach((s: unknown, i: number) => {
      if (!isObj(s)) throw new Error(`ci.yml job ${id} step ${i + 1}: not a mapping`)
      const name = typeof s.name === "string" ? s.name : typeof s.run === "string" ? s.run.split("\n")[0] ?? "" : String(s.uses ?? `step ${i + 1}`)
      const where = `ci.yml job ${id} step "${name}"`
      if (s.if !== undefined) {
        if (typeof s.if === "string" && PR_ONLY.test(s.if.trim())) {
          skipped.push({ job: id, name, reason: "pull_request only (the mirror runs as a push)" })
          return
        }
        throw new Error(`${where}: if: ${String(s.if)} is not understood; teach tools/repo/src/lib/ci-plan.ts`)
      }
      if (typeof s.uses === "string") {
        const action = s.uses.split("@")[0] as string
        const w = isObj(s.with) ? s.with : {}
        if (action === "oven-sh/setup-bun" && w["bun-version"] !== undefined) bunVersion = String(w["bun-version"])
        if (action === "actions/setup-node" && w["node-version"] !== undefined) nodeVersion = String(w["node-version"])
        if (action in HANDLED_ACTIONS) return
        const why = SKIPPED_ACTIONS[action]
        if (why !== undefined) {
          skipped.push({ job: id, name, reason: why })
          return
        }
        throw new Error(`${where}: action ${action} cannot be mirrored; teach tools/repo/src/lib/ci-plan.ts`)
      }
      if (typeof s.run !== "string") throw new Error(`${where}: neither run nor uses`)
      if (s.shell !== undefined && s.shell !== "bash") throw new Error(`${where}: shell ${String(s.shell)} is not mirrored`)
      if (s.run.includes("${{")) throw new Error(`${where}: run uses a GitHub expression the mirror cannot evaluate`)
      const cwd = typeof s["working-directory"] === "string" ? s["working-directory"] : undefined
      steps.push({ job: id, name, run: s.run.trimEnd(), ...(cwd !== undefined ? { cwd } : {}), env: strMap(s.env, where) })
    })
    jobs.push({ id, name: jobName, steps, skipped })
  }
  return { jobs, ...(bunVersion !== undefined ? { bunVersion } : {}), ...(nodeVersion !== undefined ? { nodeVersion } : {}) }
}

/** Identity of a step for de-duplication across jobs that share one clone. */
export const stepKey = (s: CiStep): string => JSON.stringify([s.run, s.cwd ?? "", Object.entries(s.env).sort()])

/** True when the job runs the root build (`bun run build` with no working-directory). */
const buildsRoot = (j: CiJob): boolean => j.steps.some((s) => s.cwd === undefined && /^bun run build(\s|$)/.test(s.run))

/**
 * Job run order for one shared clone. CI runs each job on a fresh runner; locally they share a
 * checkout, so a job that builds would leave `dist/` behind for a job that does not. Jobs without a
 * root build therefore run first (stable otherwise), so a "works only because something else built
 * it" failure still shows up.
 */
export function orderJobs(jobs: readonly CiJob[]): CiJob[] {
  return [...jobs.filter((j) => !buildsRoot(j)), ...jobs.filter(buildsRoot)]
}
