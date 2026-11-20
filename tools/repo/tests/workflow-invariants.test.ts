import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import { builtins, type BuiltinCtx } from "../src/lib/builtins.ts"
import type { CheckEntry } from "../src/lib/manifest.ts"
import { guardedTo, loadWorkflows, workflowProblems, type Workflow } from "../src/lib/workflow-invariants.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const DOCS = readFileSync(resolve(REPO, ".github/workflows/docs.yml"), "utf8")

const wf = (file: string, text: string): Workflow => ({ file, doc: parse(text) as unknown })
const messages = (ws: Workflow[]): string[] => workflowProblems(ws).map((p) => `${p.file}: ${p.message}`)

/** docs.yml as it shipped v0.19.1 (4865039cb): tag trigger, shared `pages` group, cancel-in-progress, unguarded deploy. */
const V0191_DOCS = `
on:
  push:
    branches: [main]
    tags: ["v[0-9]+.[0-9]+.[0-9]+"]
    paths: ["apps/docs/**"]
  workflow_dispatch:
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps: [{ run: "true" }]
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
    steps: [{ run: "true" }]
`

describe("workflow-invariants", () => {
  test("the repo's workflows hold", () => {
    expect(messages(loadWorkflows(REPO))).toEqual([])
  })

  test("red on today's docs.yml with the tag trigger reintroduced", () => {
    const withTag = DOCS.replace("    branches: [main]\n", '    branches: [main]\n    tags: ["v[0-9]+.[0-9]+.[0-9]+"]\n')
    expect(withTag).not.toBe(DOCS)
    expect(messages([wf(".github/workflows/docs.yml", withTag)])).toEqual([
      '.github/workflows/docs.yml: job "deploy" (environment github-pages): push.tags (v[0-9]+.[0-9]+.[0-9]+) starts runs this job cannot deploy from (github-pages admits branch main only; the v0.19.1 tag run was rejected). Remove the tag trigger and deploy releases from an admitted branch (publish.yml dispatches docs.yml on main)',
    ])
  })

  test("red on every v0.19.1 fault: tag trigger, unguarded dispatch, cancelling and unkeyed group", () => {
    const m = messages([wf(".github/workflows/docs.yml", V0191_DOCS)])
    expect(m).toHaveLength(4)
    expect(m[0]).toContain("push.tags")
    expect(m[1]).toContain("workflow_dispatch can start it on any ref")
    expect(m[2]).toContain('concurrency group "pages" sets cancel-in-progress: true')
    expect(m[3]).toContain('concurrency group "pages" is not keyed by github.ref')
  })

  test("red when another workflow shares a deploy's concurrency group", () => {
    const other = `on: push\nconcurrency:\n  group: pages-\${{ github.ref }}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: [{ run: "true" }]\n`
    expect(messages([wf(".github/workflows/docs.yml", DOCS), wf(".github/workflows/other.yml", other)])).toEqual([
      '.github/workflows/other.yml: concurrency group "pages-${{ github.ref }}" is the deploy group of .github/workflows/docs.yml; a run here can cancel or replace that deploy. Use a group of its own',
    ])
  })

  test("red on a push filter wider than the environment and on an environment with no recorded policy", () => {
    const wide = `on:\n  push:\n    branches: [main, dev]\njobs:\n  d:\n    runs-on: ubuntu-latest\n    environment: github-pages\n    steps: [{ run: "true" }]\n`
    expect(messages([wf("w.yml", wide)])[0]).toContain("push.branches (main, dev) reaches it from branches it cannot deploy from")
    const unknown = `on: push\njobs:\n  d:\n    runs-on: ubuntu-latest\n    environment: production\n    steps: [{ run: "true" }]\n`
    expect(messages([wf("w.yml", unknown)])[0]).toContain("environment production): no recorded deployment branch policy")
  })

  test("green on main-only push, guarded schedule and dispatch", () => {
    const ok = `on:\n  push:\n    branches: [main]\n  schedule: [{ cron: "0 0 * * *" }]\n  workflow_dispatch:\njobs:\n  d:\n    if: \${{ github.ref == 'refs/heads/main' }}\n    runs-on: ubuntu-latest\n    environment: github-pages\n    steps: [{ run: "true" }]\n`
    expect(messages([wf("w.yml", ok)])).toEqual([])
  })

  test("guardedTo accepts only an unconditional main-ref guard", () => {
    expect(guardedTo("github.ref == 'refs/heads/main'", ["main"])).toBe(true)
    expect(guardedTo("${{ github.ref == 'refs/heads/main' && success() }}", ["main"])).toBe(true)
    expect(guardedTo("github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch'", ["main"])).toBe(false)
    expect(guardedTo("github.ref == 'refs/heads/dev'", ["main"])).toBe(false)
    expect(guardedTo(undefined, ["main"])).toBe(false)
  })
})

describe("workflow-invariants builtin", () => {
  const dirs: string[] = []
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
  })
  const ctx: BuiltinCtx = { today: "2026-11-20", commandNames: [] }
  const entry = { id: "workflow-invariants", script: "builtin:workflow-invariants" } as CheckEntry

  test("fails with the problem and a next step on a v0.19.1-shaped repo", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-workflow-invariants-"))
    dirs.push(root)
    mkdirSync(join(root, ".github", "workflows"), { recursive: true })
    writeFileSync(join(root, ".github", "workflows", "docs.yml"), V0191_DOCS)
    const r = (builtins["workflow-invariants"] as (typeof builtins)[string])(root, entry, ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain(".github/workflows/docs.yml: job \"deploy\" (environment github-pages): push.tags")
    expect(r.next).toContain("workflow_dispatch on a branch")
  })

  test("passes on the repo", () => {
    const r = (builtins["workflow-invariants"] as (typeof builtins)[string])(REPO, entry, ctx)
    expect(r).toMatchObject({ ok: true })
  })
})
