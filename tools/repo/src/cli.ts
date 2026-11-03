import { makeIo, processStreams, type Io, type Streams } from "./lib/output.ts"
import { makeHelp } from "./commands/help.ts"
import { makeCheck } from "./commands/check.ts"
import { scopeCommand } from "./commands/scope.ts"
import { ratchetCommand } from "./commands/ratchet.ts"
import { testCommand } from "./commands/test.ts"
import { verifyCommand } from "./commands/verify.ts"
import { hookCommand } from "./commands/hook.ts"
import { statusCommand } from "./commands/status.ts"
import { wardenReportCommand } from "./commands/warden-report.ts"
import { findCommand } from "./commands/find.ts"
import { outlineCommand } from "./commands/outline.ts"
import { sessionStatsCommand } from "./commands/session-stats.ts"

export type { Io, Streams } from "./lib/output.ts"

/** A repo-CLI subcommand. */
export interface Command {
  name: string
  summary: string
  example: string
  hidden?: boolean
  /** Extra lines shown only by `<cmd> --help`. */
  detail?: readonly string[]
  run(args: readonly string[], io: Io): Promise<number>
}

/** Registry of all commands. */
export const commands: readonly Command[] = [
  makeHelp(() => commands),
  makeCheck(() => commands),
  scopeCommand,
  ratchetCommand,
  testCommand,
  verifyCommand,
  hookCommand,
  statusCommand,
  wardenReportCommand,
  findCommand,
  outlineCommand,
  sessionStatsCommand,
]

/**
 * Dispatch argv. Exit codes: 0 ok, 1 check failed, 2 usage error.
 * `streams` is injectable for tests.
 */
export async function main(
  argv: readonly string[],
  streams: Streams = processStreams,
): Promise<number> {
  const json = argv.includes("--json")
  const full = argv.includes("--full")
  const rest = argv.filter((a) => a !== "--json" && a !== "--full")
  const wantsHelp = rest.includes("--help") || rest.includes("-h")
  const [name, ...args] = rest.filter((a) => a !== "--help" && a !== "-h")
  const io = makeIo(json, streams, full)

  const cmdName = name ?? "help"
  const cmd = commands.find((c) => c.name === cmdName)
  if (!cmd) {
    return io.usage(`unknown command: ${cmdName}`, "bun run repo help")
  }
  if (wantsHelp) {
    io.data({ name: cmd.name, summary: cmd.summary, example: cmd.example })
    io.out(`${cmd.name}: ${cmd.summary}`)
    io.out(`example: ${cmd.example}`)
    for (const d of cmd.detail ?? []) io.out(d)
    return 0
  }
  const code = await cmd.run(args, io)
  io.flush()
  return code
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
