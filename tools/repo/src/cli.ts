import { makeIo, processStreams, type Io, type Streams } from "./lib/output.ts"
import { makeHelp } from "./commands/help.ts"

export type { Io, Streams } from "./lib/output.ts"

/** A repo-CLI subcommand. */
export interface Command {
  name: string
  summary: string
  example: string
  hidden?: boolean
  run(args: readonly string[], io: Io): Promise<number>
}

/** Registry of all commands. */
export const commands: readonly Command[] = [makeHelp(() => commands)]

/**
 * Dispatch argv. Exit codes: 0 ok, 1 check failed, 2 usage error.
 * `streams` is injectable for tests.
 */
export async function main(
  argv: readonly string[],
  streams: Streams = processStreams,
): Promise<number> {
  const json = argv.includes("--json")
  const rest = argv.filter((a) => a !== "--json")
  const wantsHelp = rest.includes("--help") || rest.includes("-h")
  const [name, ...args] = rest.filter((a) => a !== "--help" && a !== "-h")
  const io = makeIo(json, streams)

  const cmdName = name ?? "help"
  const cmd = commands.find((c) => c.name === cmdName)
  if (!cmd) {
    streams.stderr(`unknown command: ${cmdName}\nnext: bun run repo help\n`)
    return 2
  }
  if (wantsHelp) {
    io.data({ name: cmd.name, summary: cmd.summary, example: cmd.example })
    io.out(`${cmd.name}: ${cmd.summary}`)
    io.out(`example: ${cmd.example}`)
    return 0
  }
  if (cmd.name === "help" && args.length > 0) {
    streams.stderr(`unknown argument: ${args[0]}\nnext: bun run repo help\n`)
    return 2
  }
  return cmd.run(args, io)
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
