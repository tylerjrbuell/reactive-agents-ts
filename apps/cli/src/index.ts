#!/usr/bin/env bun

import { runInit } from "./commands/init.js";
import { runCreateAgent } from "./commands/create-agent.js";
import { runDev } from "./commands/dev.js";
import { runEval } from "./commands/eval.js";
import { runPlayground } from "./commands/playground.js";
import { runInspect } from "./commands/inspect.js";
import { runAgent } from "./commands/run.js";
import { printBanner, printVersion, VERSION } from "./banner.js";

const HELP = `
  Usage: rax <command> [options]

  Commands:
    init <name> [--template minimal|standard|full]   Scaffold a new project
    create agent <name> [--recipe basic|...]          Generate an agent file
    run <prompt> [--provider ...] [--model ...]       Run an agent with a prompt
    dev                                               Start dev server
    eval run --suite <name>                           Run evaluation suite
    playground                                        Launch interactive REPL
    inspect <agent-id> [--trace last]                 Inspect agent state
    help                                              Show this help
    version                                           Show version
`.trimEnd();

export function main(argv: string[] = process.argv.slice(2)) {
  const command = argv[0];

  switch (command) {
    case "init":
      runInit(argv.slice(1));
      break;

    case "create": {
      const subcommand = argv[1];
      if (subcommand === "agent") {
        runCreateAgent(argv.slice(2));
      } else {
        console.error(`Unknown create subcommand: ${subcommand}`);
        console.error("Usage: rax create agent <name>");
        process.exit(1);
      }
      break;
    }

    case "run":
      runAgent(argv.slice(1));
      break;

    case "dev":
      runDev(argv.slice(1));
      break;

    case "eval":
      runEval(argv.slice(1));
      break;

    case "playground":
      runPlayground(argv.slice(1));
      break;

    case "inspect":
      runInspect(argv.slice(1));
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
      console.error(`Unknown command: ${command}`);
      printBanner();
      console.log(HELP);
      process.exit(1);
  }
}

// Run if invoked directly
if (import.meta.main) {
  main();
}
