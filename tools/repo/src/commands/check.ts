import { spawnSync } from "node:child_process"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { builtins } from "../lib/builtins.ts"
import { changedFiles } from "../lib/changed-files.ts"
import { expiry, loadChecks, registryProblems, selectChecks, type CheckEntry, type Stage } from "../lib/manifest.ts"
import { resolveRoot } from "../lib/root.ts"

interface Outcome {
  id: string
  ok: boolean
}

function run(root: string, c: CheckEntry): { ok: boolean; output: string } {
  if (c.script.startsWith("builtin:")) {
    const fn = builtins[c.script.slice("builtin:".length)]
    return fn ? fn(root, c) : { ok: false, output: `unknown builtin ${c.script}` }
  }
  const r = spawnSync("bash", [c.script], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

/** `repo check`: run each registered gate once. */
export const checkCommand: Command = {
  name: "check",
  summary: "Run registered gates from checks.json, each once",
  example: "bun run repo check --changed",
  async run(args, io) {
    const bad = rejectUnknown(io, "check", args, {
      flags: ["--all", "--changed"],
      values: ["--stage", "--only", "--root"],
    })
    if (bad !== undefined) return bad
    const stage = (flagValue(args, "--stage") ?? "ci") as Stage
    if (!["hook", "pre-commit", "ci"].includes(stage))
      return io.usage(`unknown stage: ${stage}`, "bun run repo check --help")
    if (args.includes("--all") && args.includes("--changed"))
      return io.usage("--all and --changed are mutually exclusive", "bun run repo check --help")
    const root = resolveRoot(flagValue(args, "--root"))
    const only = flagValue(args, "--only")

    const checks = loadChecks(root)
    const problems = registryProblems(root, checks)
    if (problems.unregistered.length > 0) {
      const names = problems.unregistered.map((s) => s.replace(/^scripts\//, ""))
      return io.fail(
        `unregistered check scripts: ${names.join(", ")}`,
        `add ${(names[0] as string).replace(/\.sh$/, "")} to tools/repo/checks.json`,
      )
    }
    if (problems.missing.length > 0)
      return io.fail(`checks.json references missing scripts: ${problems.missing.join(", ")}`, "remove it from tools/repo/checks.json")

    const today = new Date().toISOString().slice(0, 10)
    const exp = expiry(checks, today)
    for (const id of exp.warn) io.out(`warn: ${id} is past reviewBy (tools/repo/checks.json)`)
    if (exp.fail.length > 0)
      return io.fail(`checks past reviewBy + 30 days: ${exp.fail.join(", ")}`, "bump reviewBy in tools/repo/checks.json after reviewing the entry")

    let selected: readonly CheckEntry[]
    if (only !== undefined) {
      selected = checks.filter((c) => c.id === only)
      if (selected.length === 0) return io.usage(`unknown check id: ${only}`, "bun run repo check --all")
    } else if (args.includes("--all")) selected = checks.filter((c) => c.stages.includes(stage))
    else selected = selectChecks(checks, changedFiles(root), stage)

    const outcomes: Outcome[] = []
    for (const c of selected) {
      io.out(`── ${c.id}`)
      const r = run(root, c)
      const text = r.output.trimEnd()
      if (text.length > 0) io.out(text)
      outcomes.push({ id: c.id, ok: r.ok })
    }
    const failed = outcomes.filter((o) => !o.ok)
    const summary = `checks: ${outcomes.length - failed.length} pass, ${failed.length} fail`
    io.data({ checks: outcomes, pass: outcomes.length - failed.length, fail: failed.length })
    if (failed.length > 0)
      return io.fail(`${summary}\nfailed: ${failed.map((o) => o.id).join(", ")}`, `bun run repo check --only ${(failed[0] as Outcome).id}`)
    io.out(summary)
    return 0
  },
}
