import { spawn } from "node:child_process"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { builtins, type BuiltinCtx } from "../lib/builtins.ts"
import { changedFiles } from "../lib/changed-files.ts"
import { expiry, loadChecks, registryProblems, selectChecks, type CheckEntry, type Stage } from "../lib/manifest.ts"
import { resolveRoot } from "../lib/root.ts"

interface Outcome {
  id: string
  ok: boolean
  next?: string
}

/** Run one check, forwarding output line by line as it arrives. */
function run(root: string, c: CheckEntry, ctx: BuiltinCtx, emit: (line: string) => void): Promise<{ ok: boolean; next?: string }> {
  if (c.script.startsWith("builtin:")) {
    const fn = builtins[c.script.slice("builtin:".length)]
    const r = fn ? fn(root, c, ctx) : { ok: false, output: `unknown builtin ${c.script}` }
    for (const l of r.output.split("\n")) if (l.length > 0) emit(l)
    return Promise.resolve({ ok: r.ok, ...(r.next === undefined ? {} : { next: r.next }) })
  }
  return new Promise((done) => {
    const child = spawn("bash", [c.script], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
    let pending = ""
    const feed = (chunk: Buffer): void => {
      pending += chunk.toString("utf8")
      const parts = pending.split("\n")
      pending = parts.pop() ?? ""
      for (const l of parts) emit(l)
    }
    child.stdout.on("data", feed)
    child.stderr.on("data", feed)
    child.on("close", (code) => {
      if (pending.length > 0) emit(pending)
      done({ ok: code === 0 })
    })
    child.on("error", () => done({ ok: false }))
  })
}

/** `repo check`: run each registered gate once. */
export function makeCheck(list: () => readonly Command[]): Command {
  return {
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
      const ctx: BuiltinCtx = { today, commandNames: list().map((c) => c.name) }
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
        // Lines the output cap dropped; replayed uncapped if the check fails, so failure detail is never lost.
        const dropped: string[] = []
        const emit = (l: string): void => void (io.out(l) || dropped.push(l))
        emit(`── ${c.id}`)
        const r = await run(root, c, ctx, emit)
        if (!r.ok) for (const l of dropped) io.result(l)
        outcomes.push({ id: c.id, ...r })
      }
      const failed = outcomes.filter((o) => !o.ok)
      const summary = `checks: ${outcomes.length - failed.length} pass, ${failed.length} fail`
      io.data({ checks: outcomes, pass: outcomes.length - failed.length, fail: failed.length })
      if (failed.length > 0)
        return io.fail(`${summary}\nfailed: ${failed.map((o) => o.id).join(", ")}`, (failed[0] as Outcome).next ?? `bun run repo check --only ${(failed[0] as Outcome).id}`)
      io.result(summary)
      return 0
    },
  }
}
