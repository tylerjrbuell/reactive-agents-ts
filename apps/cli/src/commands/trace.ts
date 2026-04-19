import { loadTrace, traceStats } from "@reactive-agents/trace"

const INSPECT_HELP = `
  Usage: rax trace inspect <path>

  Parse and display a JSONL trace file produced by .withTracing().

  Arguments:
    <path>    Path to the .jsonl trace file

  Options:
    --help    Show this help
`.trimEnd()

const COMPARE_HELP = `
  Usage: rax trace compare <a> <b>

  Compare summary statistics from two JSONL trace files side-by-side.

  Arguments:
    <a>    Path to the first trace file (baseline)
    <b>    Path to the second trace file (candidate)

  Options:
    --help    Show this help
`.trimEnd()

export async function traceInspect(path: string): Promise<void> {
  const trace = await loadTrace(path)
  const stats = traceStats(trace)

  console.log(`\nRun: ${trace.runId}`)
  console.log(
    `Events: ${stats.totalEvents} | Iters: ${stats.iterations} | Tokens: ${stats.totalTokens}`,
  )
  console.log(
    `Interventions: ${stats.interventionsDispatched} dispatched, ${stats.interventionsSuppressed} suppressed`,
  )
  console.log(`Max entropy: ${stats.maxEntropy.toFixed(2)}\n`)

  console.log("Timeline:")
  for (const ev of trace.events) {
    const prefix = `[iter ${String(ev.iter).padStart(2)}]`
    switch (ev.kind) {
      case "entropy-scored":
        console.log(`${prefix} entropy=${ev.composite.toFixed(2)}`)
        break
      case "intervention-dispatched":
        console.log(`${prefix} DISPATCH ${ev.decisionType} -> ${ev.patchKind}`)
        break
      case "intervention-suppressed":
        console.log(`${prefix} SUPPRESS ${ev.decisionType} (${ev.reason})`)
        break
      case "strategy-switched":
        console.log(`${prefix} ${ev.from} -> ${ev.to} (${ev.reason})`)
        break
      default:
        break
    }
  }
}

export async function traceCompare(a: string, b: string): Promise<void> {
  const ta = await loadTrace(a)
  const tb = await loadTrace(b)
  const sa = traceStats(ta)
  const sb = traceStats(tb)

  console.log(`                    A          B          D`)
  console.log(
    `Iterations:         ${sa.iterations}          ${sb.iterations}          ${sb.iterations - sa.iterations}`,
  )
  console.log(
    `Tokens:             ${sa.totalTokens}    ${sb.totalTokens}    ${sb.totalTokens - sa.totalTokens}`,
  )
  console.log(
    `Interventions:      ${sa.interventionsDispatched}          ${sb.interventionsDispatched}`,
  )
  console.log(
    `Max entropy:        ${sa.maxEntropy.toFixed(2)}      ${sb.maxEntropy.toFixed(2)}`,
  )
}

export function runTrace(args: string[]): void {
  const subcommand = args[0]

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`  Usage: rax trace <subcommand> [options]`)
    console.log(``)
    console.log(`  Subcommands:`)
    console.log(`    inspect <path>    Parse and display a JSONL trace file`)
    console.log(`    compare <a> <b>   Compare two trace files side-by-side`)
    return
  }

  const runAsync = (task: Promise<void>) => {
    void task.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`error: ${message}`)
      process.exit(1)
    })
  }

  switch (subcommand) {
    case "inspect": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(INSPECT_HELP)
        return
      }
      const path = args[1]
      if (!path) {
        console.error("error: Usage: rax trace inspect <path>")
        process.exit(1)
      }
      runAsync(traceInspect(path))
      break
    }

    case "compare": {
      if (args.includes("--help") || args.includes("-h")) {
        console.log(COMPARE_HELP)
        return
      }
      const a = args[1]
      const b = args[2]
      if (!a || !b) {
        console.error("error: Usage: rax trace compare <a> <b>")
        process.exit(1)
      }
      runAsync(traceCompare(a, b))
      break
    }

    default:
      console.error(`error: Unknown trace subcommand: ${subcommand}`)
      console.error(`       Run 'rax trace --help' for usage`)
      process.exit(1)
  }
}
