import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { main, type Streams } from "../src/cli.ts"
import { changedChunks, ciEnv, selectSteps, UNREACHABLE_OLLAMA, WORKFLOW } from "../src/commands/ci.ts"
import { orderJobs, planFromWorkflow, type CiStep } from "../src/lib/ci-plan.ts"

const REPO = resolve(import.meta.dir, "..", "..", "..")

function capture(): { s: Streams; out: () => string; err: () => string } {
  let o = ""
  let e = ""
  return { s: { stdout: (t) => void (o += t), stderr: (t) => void (e += t) }, out: () => o, err: () => e }
}

const wf = (jobs: string): string => `on: push\njobs:\n${jobs}`
const job = (id: string, steps: string): string => `  ${id}:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`

describe("planFromWorkflow", () => {
  test("the real ci.yml maps with no unknown step", () => {
    const plan = planFromWorkflow(readFileSync(join(REPO, WORKFLOW), "utf8"))
    const runs = plan.jobs.flatMap((j) => j.steps)
    const test = runs.find((s) => s.run === "bun test")
    expect(test?.env.REPO_BUDGET_FACTOR).toBe("3")
    expect(runs.some((s) => s.run === "bun run repo check --all")).toBe(true)
    expect(runs.some((s) => s.run === "bun run typecheck")).toBe(true)
    expect(plan.bunVersion).toMatch(/^\d+\.\d+\.\d+$/)
    const skipped = plan.jobs.flatMap((j) => j.skipped.map((s) => s.reason))
    expect(skipped.some((r) => r.includes("pull_request"))).toBe(true)
  })
  test("maps run steps with working-directory and env; handled actions add no step", () => {
    const plan = planFromWorkflow(
      wf(
        job(
          "a",
          [
            "      - uses: actions/checkout@abc # v4",
            "      - uses: oven-sh/setup-bun@abc\n        with:\n          bun-version: \"1.3.10\"",
            "      - run: bun run metrics\n        working-directory: apps/docs\n        env:\n          X: \"1\"",
          ].join("\n"),
        ),
      ),
    )
    expect(plan.bunVersion).toBe("1.3.10")
    expect(plan.jobs[0]?.steps).toEqual([{ job: "a", name: "bun run metrics", run: "bun run metrics", cwd: "apps/docs", env: { X: "1" } }])
  })
  test("anything unmappable throws with the job and step", () => {
    expect(() => planFromWorkflow(wf(job("a", "      - uses: some/action@v1")))).toThrow(/job a .*some\/action/)
    expect(() => planFromWorkflow(wf(job("a", "      - run: x\n        if: github.ref == 'main'")))).toThrow(/not understood/)
    expect(() => planFromWorkflow(wf(job("a", "      - run: echo ${{ secrets.X }}")))).toThrow(/GitHub expression/)
    expect(() => planFromWorkflow(wf(job("a", "      - run: x\n        shell: pwsh")))).toThrow(/shell pwsh/)
    expect(() => planFromWorkflow(wf(`  a:\n    env:\n      K: v\n    steps:\n      - run: x`))).toThrow(/job-level env/)
    expect(() => planFromWorkflow(`env:\n  K: v\n${wf(job("a", "      - run: x"))}`)).toThrow(/workflow-level env/)
  })
  test("PR-only steps and network actions are skipped with a reason", () => {
    const plan = planFromWorkflow(
      wf(job("a", "      - run: x\n        if: github.event_name == 'pull_request'\n      - uses: lycheeverse/lychee-action@abc")),
    )
    expect(plan.jobs[0]?.steps).toEqual([])
    expect(plan.jobs[0]?.skipped.map((s) => s.reason)).toEqual([expect.stringContaining("pull_request"), expect.stringContaining("network")])
  })
})

describe("orderJobs / selectSteps", () => {
  const plan = planFromWorkflow(
    wf(
      [
        job("build", "      - run: bun install --frozen-lockfile\n      - run: bun run build\n      - run: bun run typecheck"),
        job("docs", "      - run: bun install --frozen-lockfile\n      - run: bun run docs:check"),
        job("test", "      - run: bun install --frozen-lockfile\n      - run: bun run build\n      - run: bun run repo check --all\n      - run: bun test"),
      ].join("\n"),
    ),
  )
  const runs = (items: ReturnType<typeof selectSteps>): string[] => items.map((i) => ("step" in i ? i.step.run : `skip:${i.skip.name}`))
  test("jobs without a root build run first, so a missing build is not hidden", () => {
    expect(orderJobs(plan.jobs).map((j) => j.id)).toEqual(["docs", "build", "test"])
  })
  test("full and --only", () => {
    expect(runs(selectSteps(plan, { kind: "full", only: "docs" }))).toEqual(["bun install --frozen-lockfile", "bun run docs:check"])
    expect(() => selectSteps(plan, { kind: "full", only: "nope" })).toThrow(/no job nope/)
  })
  test("--fast keeps install, build, typecheck, check --all and tests of changed chunks", () => {
    expect(runs(selectSteps(plan, { kind: "fast", testDirs: ["tools/repo"] }))).toEqual([
      "bun install --frozen-lockfile",
      "bun run build",
      "bun run typecheck",
      "bun run repo check --all",
      "bun test ./tools/repo",
    ])
    expect(runs(selectSteps(plan, { kind: "fast", testDirs: [] })).at(-1)).toBe("skip:bun test")
  })
  test("--run is install plus the command", () => {
    const items = selectSteps(plan, { kind: "run", command: "bun test a.test.ts" })
    expect(runs(items)).toEqual(["bun install --frozen-lockfile", "bun test a.test.ts"])
    expect(items.map((i) => ("step" in i ? (i.step as CiStep).job : ""))).toEqual(["run", "run"])
  })
  test("changedChunks maps paths to their suite chunk", () => {
    expect(changedChunks(["tools/repo/src/a.ts", "AGENTS.md", "packages/core/x.ts"], ["packages/core", "packages/core-x", "tools/repo"])).toEqual([
      "packages/core",
      "tools/repo",
    ])
  })
})

describe("ciEnv", () => {
  test("drops keys and session vars, sets CI, temp HOME and an unreachable Ollama", () => {
    const env = ciEnv(
      { PATH: "/bin", HOME: "/home/u", ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GITHUB_TOKEN: "t", CLAUDECODE: "1", OLLAMA_HOST: "http://localhost:11434" },
      { home: "/x/home", tmp: "/x/tmp", github: "/x/gh" },
    )
    expect(env.PATH).toBe("/bin")
    expect(env.HOME).toBe("/x/home")
    expect(env.TMPDIR).toBe("/x/tmp")
    expect(env.CI).toBe("true")
    expect(env.OLLAMA_HOST).toBe(UNREACHABLE_OLLAMA)
    expect(env.BUN_INSTALL_CACHE_DIR).toBe("/home/u/.bun/install/cache")
    expect(Object.keys(env).filter((k) => /API_KEY|TOKEN|CLAUDE/.test(k))).toEqual([])
  })
})

describe("repo ci CLI", () => {
  test("--dry-run prints the mapped plan without cloning", async () => {
    const c = capture()
    expect(await main(["ci", "--dry-run"], c.s)).toBe(0)
    expect(c.out()).toContain("test · bun test")
    expect(c.out()).toContain("skipped (pull_request only")
  })
  test("bad usage exits 2", async () => {
    for (const a of [["ci", "--only", "nope", "--dry-run"], ["ci", "--fast", "--only", "test"], ["ci", "--rev", "no-such-rev-x"], ["ci", "stray"]]) {
      const c = capture()
      expect(await main(a, c.s)).toBe(2)
      expect(c.err()).toContain("next: ")
    }
  })
})
