import { existsSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"
import { matchesGlob } from "../lib/glob.ts"
import { loadChecks, type CheckEntry } from "../lib/manifest.ts"
import { resolveRoot } from "../lib/root.ts"
import { DEFAULT_MAX_SECONDS, DEFAULT_TEST_TIMEOUT, describeRun, execTests, newLogPath, spawnLogged } from "./test.ts"

/**
 * Ordered verify plan for a package dir: its tests, its typecheck, then every shell gate
 * (`scripts/*.sh`, ci stage) with a scope NARROWER than `**` that covers files under the dir.
 * Repo-wide `**` gates are left to `repo check`.
 */
export function planVerify(pkgDir: string, checks: readonly CheckEntry[]): readonly string[] {
  const dir = pkgDir.replace(/\/+$/, "")
  const probe = `${dir}/index.ts`
  const gates = checks
    .filter(
      (c) =>
        c.stages.includes("ci") &&
        !c.script.startsWith("builtin:") &&
        c.scope.some((g) => g !== "**" && matchesGlob(probe, g)),
    )
    .map((c) => `bash ${c.script}`)
  return [`bun run repo test ${dir}`, `bun run --cwd ${dir} typecheck`, ...gates]
}

function hasTypecheckScript(root: string, dir: string): boolean {
  const p = join(root, dir, "package.json")
  if (!existsSync(p)) return false
  try {
    const j: unknown = JSON.parse(readFileSync(p, "utf8"))
    const scripts = typeof j === "object" && j !== null ? (j as { scripts?: unknown }).scripts : undefined
    return typeof scripts === "object" && scripts !== null && "typecheck" in scripts
  } catch {
    return false
  }
}

const NOTE = "note: repo-wide gates not run — bun run repo check --changed"

/** `repo verify`: tests, typecheck and matching gates for one package dir. */
export const verifyCommand: Command = {
  name: "verify",
  summary: "Verify one package dir: tests, typecheck, narrow gates",
  example: "bun run repo verify packages/tools --dry-run",
  async run(args, io) {
    const { positionals: pos, flagTokens } = splitArgs(args, ["--root", "--max-seconds"])
    const bad = rejectUnknown(io, "verify", flagTokens, { flags: ["--dry-run"], values: ["--root", "--max-seconds"] })
    if (bad !== undefined) return bad
    if (pos.length !== 1) return io.usage("expected exactly one package dir", "bun run repo verify <pkg-dir>")
    const maxRaw = flagValue(args, "--max-seconds") ?? String(DEFAULT_MAX_SECONDS)
    if (!/^\d+$/.test(maxRaw) || Number(maxRaw) === 0)
      return io.usage(`--max-seconds must be a positive integer: ${maxRaw}`, "bun run repo verify --help")
    const maxSeconds = Number(maxRaw)
    const dir = (pos[0] as string).replace(/\/+$/, "")
    const root = resolveRoot(flagValue(args, "--root"))
    if (!existsSync(join(root, dir)) || !statSync(join(root, dir)).isDirectory())
      return io.usage(`no such directory: ${dir}`, "bun run repo verify <pkg-dir>")

    const typecheck = hasTypecheckScript(root, dir)
    const plan = planVerify(dir, loadChecks(root)).filter((s) => typecheck || !s.endsWith(" typecheck"))
    io.data({ dir, plan, typecheck })
    if (args.includes("--dry-run")) {
      for (const s of plan) io.out(s)
      if (!typecheck) io.out("skip: typecheck (no script)")
      io.result(NOTE)
      return 0
    }
    if (!typecheck) io.out("skip: typecheck (no script)")
    for (const step of plan) {
      let code: number
      let log: string
      if (step.startsWith("bun run repo test ")) {
        const r = await execTests(root, [dir], DEFAULT_TEST_TIMEOUT, "verify-test", maxSeconds)
        if (r.failed) return io.fail(`✗ ${step}\n${describeRun(r).join("\n")}`, `open ${r.log}`)
        io.out(`✓ ${step}`)
        continue
      } else if (step.endsWith(" typecheck")) {
        const p = newLogPath(root, "verify-typecheck")
        const r = await spawnLogged("bun", ["run", "--cwd", dir, "typecheck"], root, p, maxSeconds)
        code = r.timedOut ? 1 : r.code
        log = relative(root, p)
        if (r.timedOut) return io.fail(`✗ ${step}\nfail: timeout after ${maxSeconds}s\nlog: ${log}`, `open ${log}`)
      } else {
        const p = newLogPath(root, "verify-gate")
        const r = await spawnLogged("bash", [step.slice("bash ".length)], root, p, maxSeconds)
        code = r.timedOut ? 1 : r.code
        log = relative(root, p)
        if (r.timedOut) return io.fail(`✗ ${step}\nfail: timeout after ${maxSeconds}s\nlog: ${log}`, `open ${log}`)
      }
      if (code !== 0) return io.fail(`✗ ${step}\nlog: ${log}`, `open ${log}`)
      io.out(`✓ ${step}`)
    }
    io.result(NOTE)
    return 0
  },
}
