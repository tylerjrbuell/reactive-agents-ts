import { existsSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { loadChecks, selectChecks, type CheckEntry } from "../lib/manifest.ts"
import { resolveRoot } from "../lib/root.ts"
import { DEFAULT_TEST_TIMEOUT, describeRun, execTests, newLogPath, spawnLogged } from "./test.ts"

/**
 * Ordered verify plan for a package dir: its tests, its typecheck, then every shell
 * gate (`scripts/*.sh`, ci stage) whose scope covers files under the dir.
 */
export function planVerify(pkgDir: string, checks: readonly CheckEntry[]): readonly string[] {
  const dir = pkgDir.replace(/\/+$/, "")
  const gates = selectChecks(checks, [`${dir}/index.ts`], "ci")
    .filter((c) => !c.script.startsWith("builtin:"))
    .map((c) => `bash ${c.script}`)
  return [`bun run repo test ${dir}`, `bun run --cwd ${dir} typecheck`, ...gates]
}

function hasTypecheckScript(root: string, dir: string): boolean {
  const p = join(root, dir, "package.json")
  if (!existsSync(p)) return false
  const j: unknown = JSON.parse(readFileSync(p, "utf8"))
  const scripts = typeof j === "object" && j !== null ? (j as { scripts?: unknown }).scripts : undefined
  return typeof scripts === "object" && scripts !== null && "typecheck" in scripts
}

/** `repo verify`: tests, typecheck and matching gates for one package dir. */
export const verifyCommand: Command = {
  name: "verify",
  summary: "Verify one package dir: tests, typecheck, matching gates",
  example: "bun run repo verify packages/tools --dry-run",
  async run(args, io) {
    const pos = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--root")
    const bad = rejectUnknown(io, "verify", args.filter((a) => a.startsWith("-") || args[args.indexOf(a) - 1] === "--root"), {
      flags: ["--dry-run"],
      values: ["--root"],
    })
    if (bad !== undefined) return bad
    if (pos.length !== 1) return io.usage("expected exactly one package dir", "bun run repo verify <pkg-dir>")
    const dir = (pos[0] as string).replace(/\/+$/, "")
    const root = resolveRoot(flagValue(args, "--root"))
    if (!existsSync(join(root, dir)) || !statSync(join(root, dir)).isDirectory())
      return io.usage(`no such directory: ${dir}`, "bun run repo verify <pkg-dir>")

    const plan = planVerify(dir, loadChecks(root))
    io.data({ dir, plan })
    if (args.includes("--dry-run")) {
      for (const s of plan) io.out(s)
      return 0
    }
    for (const step of plan) {
      let code: number
      let log: string | undefined
      if (step.startsWith("bun run repo test ")) {
        const r = await execTests(root, [dir], DEFAULT_TEST_TIMEOUT, "verify-test")
        code = r.failed ? 1 : 0
        log = r.log
        if (r.failed) return io.fail(`✗ ${step}\n${describeRun(r).join("\n")}`, `open ${r.log}`)
      } else if (step.includes(" typecheck")) {
        if (!hasTypecheckScript(root, dir)) {
          io.out("skip: typecheck (no script)")
          continue
        }
        const p = newLogPath(root, "verify-typecheck")
        code = await spawnLogged("bun", ["run", "--cwd", dir, "typecheck"], root, p)
        log = relative(root, p)
      } else {
        const p = newLogPath(root, "verify-gate")
        code = await spawnLogged("bash", [step.slice("bash ".length)], root, p)
        log = relative(root, p)
      }
      if (code !== 0) return io.fail(`✗ ${step}\nlog: ${log}`, `open ${log}`)
      io.out(`✓ ${step}`)
    }
    io.result(`verified: ${dir}`)
    return 0
  },
}
