import type { Command } from "../cli.ts"
import { rejectUnknown } from "../lib/args.ts"
import { assessPressure, readPressure } from "../lib/mem-guard.ts"
import type { Io } from "../lib/output.ts"
import { pidAlive } from "../lib/test-slots.ts"
import { fmtBytes, janitorBases, realFs, sweepAll, testTmpBase } from "../lib/tmp-janitor.ts"

/**
 * Reap leaked test temp dirs (dead-PID roots + legacy prefixes older than 60 min). Returns bytes freed.
 * Shared by `repo janitor`, `repo test` and `repo ci`. Never throws.
 */
export function runJanitor(dryRun: boolean): { count: number; bytes: number; liveRoots: number } {
  try {
    const r = sweepAll(realFs, janitorBases(), { pidAlive, now: Date.now(), legacy: true, dryRun })
    return { count: r.reaped.length, bytes: r.bytes, liveRoots: r.liveRoots }
  } catch {
    return { count: 0, bytes: 0, liveRoots: 0 }
  }
}

/**
 * Pre-run hygiene for heavy commands: janitor, then the memory guard. Prints one line when something
 * was reaped or a warning applies. Returns an exit code when the run must not start, else undefined.
 */
export function preflightHeavy(io: Io, cmd: string): number | undefined {
  const j = runJanitor(false)
  if (j.count > 0) io.out(`janitor: reaped ${j.count} leaked test dirs, freed ${fmtBytes(j.bytes)}`)
  const v = assessPressure(readPressure(testTmpBase()))
  if (v.level === "warn") io.out(`warn: memory pressure (${v.lines.join("; ")}); run fewer heavy processes at once`)
  if (v.level === "refuse") {
    return io.fail(
      `${cmd} not started: ${v.lines.join("; ")}. Another heavy process or leaked temp data is eating RAM`,
      "bash scripts/mem-watch.sh   # shows top RSS processes and temp usage; free memory, then retry",
    )
  }
  return undefined
}

/** `repo janitor`: reap leaked test temp dirs. */
export const janitorCommand: Command = {
  name: "janitor",
  summary: "Reap leaked test temp dirs (dead-PID roots, stale ra-* dirs); report bytes freed",
  example: "bun run repo janitor --dry-run",
  detail: [
    "--dry-run: report what would be removed, remove nothing",
    "reaps: <tmp>/ra-tests-<pid>-* whose PID is dead (any age); legacy ra-*, corrective-guard*, w3b-triad*, rax-clean-install-test* and similar older than 60 min",
    "never touches a root whose PID is alive or repo-test-slots-*; also scans REPO_TEST_TMPDIR when set",
    "runs automatically at the start of `repo test`, `repo verify` and `repo ci`",
  ],
  async run(args, io) {
    const bad = rejectUnknown(io, "janitor", args, { values: [], flags: ["--dry-run"] })
    if (bad !== undefined) return bad
    const dry = args.includes("--dry-run")
    const j = runJanitor(dry)
    io.data(j)
    io.result(`${dry ? "would reap" : "reaped"} ${j.count} dirs, ${dry ? "would free" : "freed"} ${fmtBytes(j.bytes)}; ${j.liveRoots} live roots untouched`)
    io.result("next: bun run repo test <paths>")
    return 0
  },
}
