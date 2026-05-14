import { runInit } from "./commands/init.js";
import { runCreateAgent } from "./commands/create-agent.js";
import { runDev } from "./commands/dev.js";
import { runEval } from "./commands/eval.js";
import { runPlayground } from "./commands/playground.js";
import { runInspect } from "./commands/inspect.js";
import { runBench } from "./commands/bench.js";
import { runCortexCli } from "./commands/cortex.js";
import { runDemo } from "./commands/demo.js";
import { runAgent } from "./commands/run.js";
import { runServe } from "./commands/serve.js";
import { runDiscover } from "./commands/discover.js";
import { runDeploy } from "./commands/deploy/index.js";
import { runTrace } from "./commands/trace.js";
import { runSkills } from "./commands/skills.js";
import { runDiagnose } from "./commands/diagnose.js";
import { printBanner, printVersion, VERSION } from "./banner.js";
import { fail, info } from "./ui.js";

const HELP = `
  Usage: rax <command> [options]

  Commands:
    init <name> [--template minimal|standard|full]   Scaffold a new project
    create agent <name> [--recipe basic|...]          Generate an agent file
    run <prompt> [--provider ...] [options]           Run an agent (see --help on usage error)
    cortex [--port <n>] [--no-open] [--help]          Cortex companion studio (requires @reactive-agents/cortex)
    serve [--port <n>] [--name <name>]               Start agent as A2A server
    discover <url>                                    Fetch and display remote agent card
    dev [--entry <path>] [--no-watch]                Run agent entrypoint in dev mode
    eval run --suite <name>                           Run evaluation suite
    playground [--provider ...] [--stream] [--memory] [--memory-tier 1|2]
                  Launch interactive agent REPL
    inspect <agent-id> [--logs-tail <n>]             Inspect local deployment signals/logs
    bench [--provider ...] [--model ...] [--tier ...] [--output ...]
                  Run benchmark suite against an LLM provider
    demo                                        Run a zero-config live demo (no API key needed)
    deploy up [--target local|fly|railway|render|cloudrun|digitalocean] [--mode daemon|sdk] [--dry-run]
                              Build + deploy agent container
    deploy down [--target ...]                        Stop deployment (auto-detects target)
    deploy status [--target ...]                      Show deployment status (auto-detects target)
    deploy logs [-f] [--target ...]                   Tail deployment logs (auto-detects target)
    deploy init                                       Scaffold deployment files only (legacy alias)
    trace inspect <path>                              Parse and display a JSONL trace file
    trace compare <a> <b>                             Compare two trace files side-by-side
    diagnose <sub> [...]                              Forensic CLI for recorded traces
                                                        list | replay | replay-run | grep | diff | debrief
                                                        (run \`rax diagnose --help\` for details)
    skills export --agent <id> [--name <s>] [--out <file|dir>]   Export skills as SKILL.md
    skills import <file> --agent <id> [--rebind <id>] [--regenerate-id]   Import from SKILL.md
    skills list --agent <id>                          List skills for an agent
    help                                              Show this help
    version                                           Show version

  Quick start:
    rax demo                                    See reactive-agents in action (no setup needed)
`.trimEnd();

export function main(argv: string[] = process.argv.slice(2)) {
  const command = argv[0];
  const runAsync = (task: Promise<void>) => {
    void task.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(fail(message));
      process.exit(1);
    });
  };

  switch (command) {
    case "init":
      runInit(argv.slice(1));
      break;

    case "create": {
      const subcommand = argv[1];
      if (subcommand === "agent") {
        runAsync(runCreateAgent(argv.slice(2)));
      } else {
        console.error(fail(`Unknown create subcommand: ${subcommand}`));
        console.error(info("Usage: rax create agent <name>"));
        process.exit(1);
      }
      break;
    }

    case "run":
      runAsync(runAgent(argv.slice(1)));
      break;

    case "serve":
      runServe(argv.slice(1));
      break;

    case "discover":
      runDiscover(argv.slice(1));
      break;

    case "deploy":
      runDeploy(argv.slice(1));
      break;

    case "dev":
      runDev(argv.slice(1));
      break;

    case "eval":
      runAsync(runEval(argv.slice(1)));
      break;

    case "playground":
      runAsync(runPlayground(argv.slice(1)));
      break;

    case "inspect":
      runInspect(argv.slice(1));
      break;

    case "bench":
      runAsync(runBench(argv.slice(1)));
      break;

    case "cortex":
      runAsync(runCortexCli(argv.slice(1)));
      break;

    case "demo":
      runAsync(runDemo(argv.slice(1)));
      break;

    case "trace":
      runTrace(argv.slice(1));
      break;

    case "skills":
      runAsync(runSkills(argv.slice(1)));
      break;

    case "diagnose":
      runAsync(runDiagnose(argv.slice(1)));
      break;

    case "version":
    case "--version":
    case "-v":
      printVersion();
      break;

    case "help":
    case "--help":
    case "-h":
    case undefined:
      printBanner();
      console.log(HELP);
      break;

    default:
      console.error(fail(`Unknown command: ${command}`));
      printBanner();
      console.log(HELP);
      process.exit(1);
  }
}

// Run if invoked directly
if (import.meta.main) {
  main();
}
