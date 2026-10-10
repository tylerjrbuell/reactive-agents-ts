import { section, kv, muted, fail, info, hint } from '../ui.js'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const EXAMPLES_DIR = resolve(__dirname, '../../../examples')
const DEMOS_DIR = join(EXAMPLES_DIR, 'src/demos')

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

  Examples:
    rax examples suite                           # Run all examples
    rax examples suite --offline                 # Run only offline examples
    rax examples suite --filter foundations      # Run only foundations category
    rax examples suite 01 05 12                  # Run specific examples
    rax examples demo island-sim                 # Run island simulation (starts server)
    rax examples demo island-sim --provider ollama --model cogito:14b --port 3007
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
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }

  const subcommand = args[0]
  const subArgs = args.slice(1)

  switch (subcommand) {
    case 'suite': {
      // Run the example suite in-process by importing the examples module
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
      console.log(info(`Running demo: ${demo.name} (${demo.type})`))
      console.log(kv('File', demo.file))
      console.log()

      // For demos, we still need to spawn since they may be interactive or servers
      // Use Bun.spawn which works in the CLI source context
      const fullCmd = ['bun', 'run', demoPath, ...subArgs.slice(1)]
      return new Promise((resolve, reject) => {
        const child = Bun.spawn({
          cmd: fullCmd,
          cwd: DEMOS_DIR,
          env: process.env,
          stdout: 'inherit',
          stderr: 'inherit',
          stdin: 'inherit',
        })
        child.exited.then((code) => {
          if (code === 0) resolve()
          else reject(new Error(`Process exited with code ${code}`))
        }).catch(reject)
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