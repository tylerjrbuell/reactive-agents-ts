import { section, kv, muted, fail, info, hint } from '../ui.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
// src layout: apps/cli/src/commands -> apps/examples
// dist layout (single-file bundle): apps/cli/dist -> apps/examples
const EXAMPLES_DIR_CANDIDATES = [
  resolve(__dirname, '../../../examples'),
  resolve(__dirname, '../../examples'),
]
const EXAMPLES_DIR = EXAMPLES_DIR_CANDIDATES.find((dir) => existsSync(join(dir, 'index.ts')))
  ?? EXAMPLES_DIR_CANDIDATES[0]!
const DEMOS_DIR = join(EXAMPLES_DIR, 'src/demos')

/**
 * Resolve the JS runtime capable of running a demo .ts file.
 * Under Bun, process.execPath is the absolute bun binary (no PATH lookup).
 * Otherwise fall back to a `bun` on PATH.
 */
function resolveDemoRuntime(): string {
  const versions = (process as unknown as { versions?: Record<string, string> }).versions
  if (typeof versions?.bun === 'string') return process.execPath
  return 'bun'
}

const MINDS_MODES = ['scripted', 'judgment', 'llm'] as const
type MindsMode = (typeof MINDS_MODES)[number]

/**
 * Extract `--minds <mode>` / `--minds=<mode>` from demo passthrough args.
 * Returns the selected mode, whether the flag was explicitly passed, and the
 * remaining args to forward to the demo process.
 */
function takeMinds(args: string[]): { mode: MindsMode; explicit: boolean; rest: string[] } {
  const rest: string[] = []
  let found: string | undefined
  let explicit = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--minds') {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('-')) {
        console.error(fail(`Missing value for --minds (expected: ${MINDS_MODES.join('|')})`))
        process.exit(1)
      }
      found = value
      explicit = true
      i++
      continue
    }
    if (arg.startsWith('--minds=')) {
      found = arg.slice('--minds='.length)
      explicit = true
      continue
    }
    rest.push(arg)
  }
  if (!explicit) return { mode: 'scripted', explicit, rest }
  if (!(MINDS_MODES as readonly string[]).includes(found!)) {
    console.error(fail(`Invalid --minds mode: ${found} (expected: ${MINDS_MODES.join('|')})`))
    process.exit(1)
  }
  return { mode: found as MindsMode, explicit, rest }
}

const HELP = `
  Usage: rax examples <subcommand> [options]

  Run Reactive Agents examples and demos.

  Subcommands:
    suite               Run the full example suite (apps/examples/index.ts)
    demo <name>         Run a named demo from apps/examples/src/demos/
    list                List available demos

  Suite options:
    --offline           Run only offline examples (no API key needed)
    --strict            Treat xfail unexpected passes as failures
    --filter <category> Filter by category (foundations, tools, multi-agent, trust, advanced, reasoning, interaction, gateway, streaming, messaging, observe, research, demos)
    <numbers>           Run specific examples by number (e.g. 01 05 12)

  Demo options (passed through to the demo process):
    --port <n>          Port for server-based demos (default: auto)
    --provider <name>   LLM provider for demos that accept one (e.g. island-sim blueprint/narrator)
    --model <name>      Model for demos that accept one (e.g. ISLAND_SIM_MODEL)
    --minds <mode>      island-sim survivor minds: scripted (default), judgment, llm
                        (judgment/llm are high latency/expense; need a live provider)

  Examples:
    rax examples suite                           # Run all examples
    rax examples suite --offline                 # Run only offline examples
    rax examples suite --filter foundations      # Run only foundations category
    rax examples suite 01 05 12                  # Run specific examples
    rax examples demo island-sim                 # Run island simulation (starts server)
    rax examples demo island-sim --provider ollama --model cogito:14b --port 3007
    rax examples demo island-sim --minds judgment # Model-driven survivor decisions
    rax examples demo halopedia-agent            # Run Halopedia agent (interactive CLI)
    rax examples demo durable-resume             # Run durable execution demo
    rax examples list                            # List available demos
`.trimEnd()

interface DemoConfig {
  name: string
  file: string
  type: 'server' | 'interactive' | 'script'
  description: string
}

const DEMOS: DemoConfig[] = [
  {
    name: 'island-sim',
    file: 'island-sim/index.ts',
    type: 'server',
    description: 'Survival island simulation with web UI (starts HTTP server)',
  },
  {
    name: 'halopedia-agent',
    file: 'halopedia-agent.ts',
    type: 'interactive',
    description: 'Halo lore expert agent with Halopedia research tools (interactive CLI)',
  },
  {
    name: 'durable-resume',
    file: 'durable-resume.ts',
    type: 'script',
    description: 'Durable execution demo — kill mid-run, resume from disk',
  },
  {
    name: 'canonical-chat-session',
    file: 'canonical-chat-session.ts',
    type: 'interactive',
    description: 'Canonical chat session demo with persistence',
  },
  {
    name: 'canonical-chat-session-node',
    file: 'canonical-chat-session-node.ts',
    type: 'interactive',
    description: 'Canonical chat session demo (Node.js version)',
  },
  {
    name: 'local-vs-frontier',
    file: 'local-vs-frontier.ts',
    type: 'script',
    description: 'Compare local vs frontier model behavior',
  },
]

function printDemos() {
  console.log(section('Available Demos'))
  console.log()
  for (const demo of DEMOS) {
    const typeLabel = demo.type === 'server' ? '🌐 server' : demo.type === 'interactive' ? '💬 interactive' : '📜 script'
    console.log(kv(demo.name, `${typeLabel} — ${demo.description}`))
  }
  console.log()
  console.log(hint('Run with: rax examples demo <name>'))
}

export async function runExamples(args: string[]): Promise<void> {
  const subcommand = args[0]
  const subArgs = args.slice(1)

  // `--help` prints the examples help, unless it targets a known demo —
  // `rax examples demo island-sim --help` forwards to the demo process,
  // which prints its own usage.
  const demoTarget = subcommand === 'demo' ? subArgs[0] : undefined
  const forwardsHelp = demoTarget !== undefined
    && demoTarget !== 'list'
    && DEMOS.some((d) => d.name === demoTarget)
  if ((args.includes('--help') || args.includes('-h')) && !forwardsHelp) {
    console.log(HELP)
    return
  }

  switch (subcommand) {
    case 'suite': {
      // Run the example suite in-process by importing the examples module
      const suiteEntry = join(EXAMPLES_DIR, 'index.ts')
      if (!existsSync(suiteEntry)) {
        console.error(fail(`Example suite not found: ${suiteEntry}`))
        console.error(info('The published CLI does not ship apps/examples. Run from a repo checkout, or: bun run apps/examples/index.ts --offline'))
        process.exit(1)
      }
      console.log(info(`Running example suite from ${EXAMPLES_DIR}`))
      console.log()
      // Import the examples module and call its runExamples function
      // Create a file:// URL from the absolute path
      const examplesUrl = new URL(`${EXAMPLES_DIR}/index.ts`, 'file://').href
      const examplesModule = await import(examplesUrl)
      // Construct argv array for the examples runner
      const argv = ['bun', 'run', 'index.ts', ...subArgs]
      await examplesModule.runExamples(argv)
      break
    }

    case 'demo': {
      const demoName = subArgs[0]
      if (!demoName) {
        console.error(fail('Usage: rax examples demo <name>'))
        console.log()
        printDemos()
        process.exit(1)
      }

      if (demoName === 'list') {
        printDemos()
        return
      }

      const demo = DEMOS.find((d) => d.name === demoName)
      if (!demo) {
        console.error(fail(`Unknown demo: ${demoName}`))
        console.log()
        printDemos()
        process.exit(1)
      }

      const demoPath = join(DEMOS_DIR, demo.file)
      if (!existsSync(demoPath)) {
        console.error(fail(`Demo file not found: ${demoPath}`))
        console.error(info('The published CLI does not ship apps/examples. Run from a repo checkout, or: bun run apps/examples/src/demos/island-sim/index.ts'))
        process.exit(1)
      }

      const { mode: minds, explicit: mindsExplicit, rest: demoArgs } = takeMinds(subArgs.slice(1))
      if (mindsExplicit && demo.name !== 'island-sim') {
        console.error(fail('--minds is only supported for the island-sim demo'))
        process.exit(1)
      }
      // An explicit --minds wins over ambient env; otherwise inherit env untouched.
      const mindsEnv: Record<string, string> = !mindsExplicit ? {} : {
        ISLAND_SIM_JUDGMENT: minds === 'judgment' ? '1' : '0',
        ISLAND_SIM_LLM_DECISIONS: minds === 'llm' ? '1' : '0',
      }
      console.log(info(`Running demo: ${demo.name} (${demo.type})`))
      console.log(kv('File', demo.file))
      if (demo.name === 'island-sim') console.log(kv('Minds', mindsExplicit ? minds : 'scripted (default)'))
      console.log()

      // Spawn via node:child_process so this works under both Bun and Node.
      // Use the absolute bun binary when running under Bun to avoid PATH lookup
      // failures; a missing cwd previously surfaced as `posix_spawn 'bun'` ENOENT.
      const runtime = resolveDemoRuntime()
      const fullArgs = ['run', demoPath, ...demoArgs]
      const cwd = existsSync(DEMOS_DIR) ? DEMOS_DIR : process.cwd()
      return new Promise<void>((resolvePromise, reject) => {
        const child = spawn(runtime, fullArgs, {
          cwd,
          env: { ...process.env, ...mindsEnv },
          stdio: 'inherit',
        })
        child.on('error', (err) => {
          reject(new Error(
            `Failed to launch demo with ${runtime}: ${err instanceof Error ? err.message : String(err)}`
          ))
        })
        child.on('close', (code) => {
          if (code === 0) resolvePromise()
          else reject(new Error(`Process exited with code ${code}`))
        })
      })
    }

    case 'list': {
      printDemos()
      break
    }

    default: {
      console.error(fail(`Unknown subcommand: ${subcommand || '(none)'}`))
      console.log()
      console.log(HELP)
      process.exit(1)
    }
  }
}