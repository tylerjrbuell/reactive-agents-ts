// apps/cli/src/commands/deploy/index.ts
// Thin dispatcher — delegates all work to provider adapters via registry.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DeployOptions, DeployTarget, DeployMode, DeployContext } from "./types.js";
import { VALID_TARGETS, VALID_MODES } from "./types.js";
import { scaffoldSdkServer, detectAgentName, detectMonorepoRoot } from "./scaffold.js";
import { getProvider, detectTarget, printPreflightReport } from "./registry.js";

const HELP = `
  Usage: rax deploy <command> [options]

  Deploy a reactive agent to a local or remote container target.

  Commands:
    init                Scaffold deployment files only (Docker)
    up                  Scaffold (if needed) + build + deploy
    down                Stop and remove deployment
    status              Show deployment status
    logs                Tail deployment logs

  Targets:
    local               Docker Compose on local machine (default)
    fly                 Fly.io — global edge containers
    railway             Railway.app — simple PaaS
    render              Render — auto-deploy from Git
    cloudrun            Google Cloud Run — serverless containers
    digitalocean        DigitalOcean App Platform (+ GPU Droplets)

  Modes:
    daemon              Full agent with gateway loop (default)
    sdk                 Light HTTP API server (POST /chat, SSE /chat/stream)

  Options:
    --target <target>   Deployment target (see above)
    --mode <mode>       Deploy mode: daemon (default) or sdk
    --dry-run           Validate prerequisites without deploying
    --scaffold-only     Generate config files without deploying
    --name <name>       Agent name (default: auto-detect from package.json)
    --topology <type>   Deployment topology: single (default)
    --gpu               Include GPU compose for local models (digitalocean)
    --build             Force rebuild before deploying
    --follow, -f        Follow log output (for 'logs' command)
    --help, -h          Show this help

  Examples:
    rax deploy up                                # scaffold + deploy locally via Docker
    rax deploy up --dry-run                      # validate without deploying
    rax deploy up --target fly --dry-run         # check Fly.io prerequisites
    rax deploy up --target local --mode sdk      # deploy as HTTP API locally
    rax deploy up --target fly                   # scaffold + deploy to Fly.io
    rax deploy up --target fly --scaffold-only   # generate fly.toml only
    rax deploy up --target render --mode sdk     # scaffold Render + SDK server
    rax deploy up --target cloudrun              # deploy to Google Cloud Run
    rax deploy up --target digitalocean          # deploy to DO App Platform
    rax deploy up --target digitalocean --gpu    # scaffold GPU Droplet + Ollama
    rax deploy up --target railway               # scaffold + deploy to Railway
    rax deploy down                              # stop deployment (auto-detects target)
    rax deploy status                            # show status (auto-detects target)
    rax deploy logs -f                           # tail logs (auto-detects target)
    rax deploy init                              # scaffold Docker files only (legacy)
`.trimEnd();

export function runDeploy(argv: string[]) {
  const subcommand = argv[0];

  switch (subcommand) {
    case "up":
      runDeployUp(argv.slice(1));
      break;
    case "down":
      runDeployLifecycle("down", argv.slice(1));
      break;
    case "status":
      runDeployLifecycle("status", argv.slice(1));
      break;
    case "logs":
      runDeployLifecycle("logs", argv.slice(1));
      break;
    case "init":
      // Legacy compat — equivalent to `up --scaffold-only --target local`
      runDeployUp(["--scaffold-only", ...argv.slice(1)]);
      break;
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown deploy subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(1);
  }
}

// ─── Parse Options ──────────────────────────────────────────────────────────

function parseOptions(argv: string[]): DeployOptions {
  const opts: DeployOptions = {
    target: "local",
    mode: "daemon",
    name: "",
    topology: "single",
    scaffoldOnly: false,
    follow: false,
    build: false,
    detach: true,
    gpu: false,
    dryRun: false,
  };

  let targetExplicit = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--target":
        opts.target = argv[++i] as DeployTarget;
        targetExplicit = true;
        break;
      case "--mode":
        opts.mode = argv[++i] as DeployMode;
        break;
      case "--name":
        opts.name = argv[++i];
        break;
      case "--topology":
        opts.topology = argv[++i];
        break;
      case "--scaffold-only":
        opts.scaffoldOnly = true;
        break;
      case "--build":
        opts.build = true;
        break;
      case "--gpu":
        opts.gpu = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--follow":
      case "-f":
        opts.follow = true;
        break;
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
    }
  }

  // Auto-detect target from config files if not explicitly set
  if (!targetExplicit) {
    const detected = detectTarget(process.cwd());
    if (detected) {
      opts.target = detected;
    }
  }

  if (!VALID_TARGETS.includes(opts.target)) {
    console.error(`Unknown target: "${opts.target}". Available: ${VALID_TARGETS.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_MODES.includes(opts.mode)) {
    console.error(`Unknown mode: "${opts.mode}". Available: ${VALID_MODES.join(", ")}`);
    process.exit(1);
  }

  if (!opts.name) {
    opts.name = detectAgentName(process.cwd());
  }

  return opts;
}

/** Build the DeployContext from parsed options */
function buildContext(opts: DeployOptions): DeployContext {
  const cwd = process.cwd();
  return {
    cwd,
    opts,
    agentName: opts.name,
    monorepoRoot: detectMonorepoRoot(cwd),
  };
}

// ─── Deploy Up ──────────────────────────────────────────────────────────────

function runDeployUp(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const opts = parseOptions(argv);
  const ctx = buildContext(opts);
  const provider = getProvider(opts.target);

  console.log(`\n🚀 rax deploy up — target: ${opts.target}, mode: ${opts.mode}, agent: ${opts.name}\n`);

  // Dry-run: run preflight only and print report
  if (opts.dryRun) {
    const report = provider.preflight(ctx);
    printPreflightReport(report);
    process.exit(report.ok ? 0 : 1);
  }

  // SDK mode: scaffold server.ts first
  if (opts.mode === "sdk") {
    const serverPath = join(ctx.cwd, "server.ts");
    if (!existsSync(serverPath)) {
      console.log("  Scaffolding SDK server...\n");
      scaffoldSdkServer(ctx.cwd, opts.name);
    } else {
      console.log("  SDK server.ts already exists\n");
    }
  }

  // Delegate to provider adapter
  provider.up(ctx);
}

// ─── Lifecycle Commands (down/status/logs) ──────────────────────────────────

function runDeployLifecycle(command: "down" | "status" | "logs", argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  const opts = parseOptions(argv);
  const ctx = buildContext(opts);
  const provider = getProvider(opts.target);

  switch (command) {
    case "down":
      provider.down(ctx);
      break;
    case "status":
      provider.status(ctx);
      break;
    case "logs":
      provider.logs(ctx);
      break;
  }
}
