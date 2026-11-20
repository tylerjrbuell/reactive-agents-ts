import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse } from "yaml"

const REPO = resolve(import.meta.dir, "..", "..", "..")

type Obj = Record<string, unknown>
type Step = { name?: string; id?: string; run?: string; if?: string; env?: Obj }

const load = (file: string): Obj => parse(readFileSync(resolve(REPO, ".github/workflows", file), "utf8")) as Obj
const docs = (): Obj => load("docs.yml")
const docsOn = (): { push: { branches?: string[]; tags?: string[] }; workflow_dispatch: { inputs: Obj } } =>
  docs().on as { push: { branches?: string[]; tags?: string[] }; workflow_dispatch: { inputs: Obj } }
const deployJob = (): Obj => (docs().jobs as Obj).deploy as Obj

/**
 * The github-pages environment admits branch main only (recorded in tools/repo/src/lib/workflow-invariants.ts).
 * v0.19.1: a `tags:` trigger on docs.yml started a run the environment rejected, and its shared concurrency group
 * cancelled the main deploy. Releases now redeploy the docs from main through publish.yml.
 */
describe("docs.yml deploys only from main", () => {
  test("push triggers on main only, never on tags", () => {
    const push = docsOn().push
    expect(push.branches).toEqual(["main"])
    expect(push.tags).toBeUndefined()
    expect("tags-ignore" in push).toBe(false)
  })

  test("the deploy job is guarded to main, so a branch dispatch builds without deploying", () => {
    expect(deployJob().if).toBe("github.ref == 'refs/heads/main'")
  })

  test("workflow_dispatch takes the release version and the build passes it as RA_DOCS_VERSION", () => {
    expect(Object.keys(docsOn().workflow_dispatch.inputs)).toEqual(["version"])
    const build = ((docs().jobs as Obj).build as { steps: Step[] }).steps.find((s) => s.name === "Build Astro site")
    expect(build?.env?.RA_DOCS_VERSION).toBe("${{ inputs.version }}")
  })
})

describe("publish.yml redeploys the docs on main after a release", () => {
  const publish = load("publish.yml")
  const steps = ((publish.jobs as Obj).release as { steps: Step[] }).steps
  const at = (pred: (s: Step) => boolean): number => steps.findIndex(pred)

  test("dispatches docs.yml on main with the release version, after the sync to main", () => {
    const sync = at((s) => s.id === "sync")
    const deploy = at((s) => (s.run ?? "").includes("gh workflow run docs.yml"))
    expect(sync).toBeGreaterThan(-1)
    expect(deploy).toBeGreaterThan(sync)
    const step = steps[deploy] as Step
    expect(step.run).toBe('gh workflow run docs.yml --ref main -f version="$VERSION"')
    expect(step.env?.VERSION).toBe("${{ steps.ver.outputs.version }}")
    // Runs when the sync landed, even if the release-notes step before it failed (v0.18/v0.19 did).
    expect(step.if).toBe("${{ !cancelled() && steps.sync.outcome == 'success' }}")
  })

  test("has the actions: write permission the dispatch needs", () => {
    expect((publish.permissions as Obj).actions).toBe("write")
  })
})
