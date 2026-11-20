import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"

const REPO = resolve(import.meta.dir, "..", "..", "..")
const PREFLIGHT = "./.github/actions/release-preflight"

type Step = {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, string>
  env?: Record<string, string>
  "working-directory"?: string
}
type Obj = Record<string, unknown>
const yaml = (path: string): Obj => parse(readFileSync(resolve(REPO, path), "utf8")) as Obj
const jobSteps = (file: string, job: string): Step[] => (((yaml(file).jobs as Obj)[job] as Obj).steps as Step[])
const runs = (steps: Step[]): string[] => steps.flatMap((s) => (s.run === undefined ? [] : [s.run.trim()]))

/** The preflight commands, in order. publish.yml must reach them only through the shared action. */
const PREFLIGHT_RUNS = [
  "bun install --frozen-lockfile",
  "bun run build",
  "bun run typecheck",
  "bun test",
  "bun run scripts/test-clean-install.ts",
  'bun scripts/release.ts "$VERSION" --dry-run',
]
const PREFLIGHT_SHAPES = [/bun install/, /bun run build/, /bun run typecheck/, /^bun test\b/m, /test-clean-install/, /--dry-run/]

describe("release preflight is one step list shared by publish.yml and release-rehearsal.yml", () => {
  const action = yaml(".github/actions/release-preflight/action.yml")
  const actionSteps = (action.runs as { steps: Step[] }).steps
  const publish = jobSteps(".github/workflows/publish.yml", "release")
  const rehearsal = jobSteps(".github/workflows/release-rehearsal.yml", "rehearse")

  test("the action runs exactly the preflight commands, and publishes nothing", () => {
    expect(runs(actionSteps)).toEqual(PREFLIGHT_RUNS)
    // Steps only, so comments and the description do not count.
    expect(JSON.stringify(actionSteps)).not.toMatch(/npm publish|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/)
  })

  test("both workflows call the action once with their resolved version", () => {
    for (const steps of [publish, rehearsal]) {
      const calls = steps.filter((s) => s.uses === PREFLIGHT)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.with?.version).toBe("${{ steps.ver.outputs.version }}")
    }
  })

  test("neither workflow re-runs a preflight command outside the action (so the two cannot drift)", () => {
    // Steps in a working-directory (the docs build in apps/docs) are not workspace preflight.
    for (const steps of [publish, rehearsal])
      for (const r of runs(steps.filter((s) => s["working-directory"] === undefined))) for (const shape of PREFLIGHT_SHAPES) expect({ run: r, hit: shape.test(r) }).toEqual({ run: r, hit: false })
  })

  test("publish.yml publishes after the preflight; the rehearsal runs the same release.ts without publishing", () => {
    const pre = publish.findIndex((s) => s.uses === PREFLIGHT)
    const rel = publish.findIndex((s) => s.run === "bun scripts/release.ts ${{ steps.ver.outputs.version }}")
    expect(pre).toBeGreaterThan(-1)
    expect(rel).toBeGreaterThan(pre)
    expect(runs(rehearsal)).toContain('bun scripts/release.ts "$VERSION" --no-publish')
  })

  test("both build the GitHub release body with scripts/release-notes.ts", () => {
    for (const steps of [publish, rehearsal]) expect(runs(steps).some((r) => r.includes("bun scripts/release-notes.ts"))).toBe(true)
  })

  test("the rehearsal holds no secrets and cannot write to the repo", () => {
    expect(yaml(".github/workflows/release-rehearsal.yml").permissions).toEqual({ contents: "read" })
    expect(JSON.stringify(rehearsal)).not.toMatch(/secrets\.|npm publish|git push|gh release|git tag/)
  })

  test("the rehearsal builds the docs at the version publish.yml dispatches them with", () => {
    const docs = rehearsal.find((s) => s.name === "Docs build at the release version")
    expect(docs?.env?.RA_DOCS_VERSION).toBe("${{ steps.ver.outputs.version }}")
  })
})
