import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "yaml"

/**
 * Deploy invariants for `.github/workflows/*`: rules GitHub enforces only when a run reaches a deploy job,
 * which for a release path means first at the tag. The v0.19.1 docs deploy hit both: a `tags:` trigger the
 * environment rejects, and a shared `pages` concurrency group through which that doomed run cancelled the main
 * deploy. actionlint (scripts/check-actionlint.sh) covers syntax and expressions; this covers repo policy.
 */

/**
 * Branches each deployment environment admits. Read 2026-11-20 with
 * `gh api repos/tylerjrbuell/reactive-agents-ts/environments/github-pages/deployment-branch-policies`:
 * one policy, `{ name: "main", type: "branch" }`, with `custom_branch_policies: true` and no tag policy, so GitHub
 * rejects every other ref at the deploy job ("Tag "v0.19.1" is not allowed to deploy to github-pages due to
 * environment protection rules"). The environment is owner-controlled: when it changes, re-read it and update this
 * constant in the same change.
 */
export const ENVIRONMENT_BRANCHES: Readonly<Record<string, readonly string[]>> = {
  "github-pages": ["main"],
}

/** One violated invariant. */
export interface WorkflowProblem {
  /** Repo-relative workflow path. */
  file: string
  message: string
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** `on:` as trigger name -> its config (null when none). */
function triggers(on: unknown): Map<string, unknown> {
  if (typeof on === "string") return new Map([[on, null]])
  if (Array.isArray(on)) return new Map(strings(on).map((t) => [t, null]))
  return isObj(on) ? new Map(Object.entries(on)) : new Map()
}

function environmentName(env: unknown): string | undefined {
  if (typeof env === "string") return env
  return isObj(env) && typeof env.name === "string" ? env.name : undefined
}

/** True when a job-level `if:` restricts the job to one of `branches` (`github.ref == 'refs/heads/<b>'`, no `||`). */
export function guardedTo(ifExpr: unknown, branches: readonly string[]): boolean {
  if (typeof ifExpr !== "string") return false
  const e = ifExpr.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1")
  if (e.includes("||")) return false
  return branches.some((b) => new RegExp(`github\\.ref\\s*==\\s*'refs/heads/${escapeRe(b)}'`).test(e))
}

interface Concurrency {
  group: string
  cancel: unknown
}
function concurrency(v: unknown): Concurrency | undefined {
  if (typeof v === "string") return { group: v, cancel: undefined }
  if (isObj(v) && typeof v.group === "string") return { group: v.group, cancel: v["cancel-in-progress"] }
  return undefined
}

/** A parsed workflow file. */
export interface Workflow {
  file: string
  doc: unknown
}

/** Every problem across `workflows`. Pure: tests feed fixtures, the gate feeds the repo (`loadWorkflows`). */
export function workflowProblems(workflows: readonly Workflow[]): WorkflowProblem[] {
  const out: WorkflowProblem[] = []
  /** Deploy concurrency groups, by file, for the cross-workflow sharing check. */
  const deployGroups: { file: string; group: string }[] = []

  for (const { file, doc } of workflows) {
    if (!isObj(doc) || !isObj(doc.jobs)) continue
    const on = triggers(doc.on)
    const wfConcurrency = concurrency(doc.concurrency)
    for (const [jobId, job] of Object.entries(doc.jobs)) {
      if (!isObj(job)) continue
      const env = environmentName(job.environment)
      if (env === undefined) continue
      const add = (message: string): void => {
        out.push({ file, message: `job "${jobId}" (environment ${env}): ${message}` })
      }
      const branches = ENVIRONMENT_BRANCHES[env]
      if (branches === undefined) {
        add(
          `no recorded deployment branch policy; read it with gh api repos/<owner>/<repo>/environments/${env}/deployment-branch-policies and add it to ENVIRONMENT_BRANCHES in tools/repo/src/lib/workflow-invariants.ts`,
        )
        continue
      }
      const admits = `${env} admits branch ${branches.join(", ")} only`
      const guarded = guardedTo(job.if, branches)

      // Triggers: every ref that can start this job must be one the environment admits.
      for (const [name, cfg] of on) {
        const c = isObj(cfg) ? cfg : {}
        if (name === "push") {
          const tags = [...strings(c.tags), ...strings(c["tags-ignore"])]
          if (tags.length > 0 || "tags" in c || "tags-ignore" in c)
            add(
              `push.tags (${tags.join(", ") || "any"}) starts runs this job cannot deploy from (${admits}; the v0.19.1 tag run was rejected). Remove the tag trigger and deploy releases from an admitted branch (publish.yml dispatches docs.yml on main)`,
            )
          const named = strings(c.branches)
          const onlyTags = !("branches" in c) && !("branches-ignore" in c) && ("tags" in c || "tags-ignore" in c)
          const outside = "branches-ignore" in c || (!onlyTags && named.length === 0) || named.some((b) => !branches.includes(b))
          if (outside && !guarded)
            add(`push.branches (${named.join(", ") || "any"}) reaches it from branches it cannot deploy from (${admits}); narrow the filter or add if: github.ref == 'refs/heads/${branches[0]}' to the job`)
        } else if (!guarded) {
          add(`${name} can start it on any ref but ${admits}; add if: github.ref == 'refs/heads/${branches[0]}' to the job`)
        }
      }

      // Concurrency: nothing from another ref may share the group, and a started deploy is never cancelled.
      for (const conc of [wfConcurrency, concurrency(job.concurrency)]) {
        if (conc === undefined) continue
        deployGroups.push({ file, group: conc.group })
        if (conc.cancel !== undefined && conc.cancel !== false)
          add(
            `concurrency group "${conc.group}" sets cancel-in-progress: ${String(conc.cancel)}, so a newer run cancels a deploy in flight (v0.19.1: the tag run cancelled the main deploy); set it to false`,
          )
        if (!/github\.ref\b/.test(conc.group))
          add(`concurrency group "${conc.group}" is not keyed by github.ref, so a run on any other ref joins it and can replace a pending deploy; key it by \${{ github.ref }}`)
      }
    }
  }

  // A group expression with github.workflow evaluates per workflow, so equal text in two files is not shared.
  for (const d of deployGroups) {
    if (/github\.workflow\b/.test(d.group)) continue
    for (const { file, doc } of workflows) {
      if (file === d.file || !isObj(doc)) continue
      const groups = [concurrency(doc.concurrency), ...(isObj(doc.jobs) ? Object.values(doc.jobs).map((j) => (isObj(j) ? concurrency(j.concurrency) : undefined)) : [])]
      if (groups.some((g) => g?.group === d.group))
        out.push({ file, message: `concurrency group "${d.group}" is the deploy group of ${d.file}; a run here can cancel or replace that deploy. Use a group of its own` })
    }
  }
  return out
}

/** Parse `.github/workflows/*.yml|yaml` under `root`, sorted by path. */
export function loadWorkflows(root: string): Workflow[] {
  const dir = join(root, ".github", "workflows")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({ file: `.github/workflows/${f}`, doc: parse(readFileSync(join(dir, f), "utf8")) as unknown }))
}
