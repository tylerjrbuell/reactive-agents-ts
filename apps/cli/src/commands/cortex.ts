// File: apps/cli/src/commands/cortex.ts
// rax cortex — lazy-loads @reactive-agents/cortex (optional peer dep).
import { banner, fail, info, kv, section } from "../ui.js";

const DEFAULT_PORT = 4321;

export interface CortexCommandOptions {
  readonly port?: number;
  readonly noOpen?: boolean;
}

export function printCortexHelp(): void {
  console.log(`
${section("rax cortex — Companion studio")}
  Visual UI + API for inspecting and managing reactive-agents in real time.

${section("Usage")}
  rax cortex [options]

${section("Options")}
  --port <n>     API listen port (default: ${DEFAULT_PORT}, or env CORTEX_PORT)
  --no-open      Do not open a browser on start (or set CORTEX_NO_OPEN=1)
  -h, --help     Show this help

${section("Install")}
  rax cortex requires @reactive-agents/cortex:
    bun add @reactive-agents/cortex

${section("Environment")}
  CORTEX_PORT       Server port (default ${DEFAULT_PORT})
  CORTEX_NO_OPEN    Set to 1 to skip opening the browser
  CORTEX_URL        Base URL agents use to reach ingest
`.trimEnd());
}

export function parseCortexArgv(
  argv: readonly string[],
): CortexCommandOptions & { readonly showHelp: boolean } {
  let port: number | undefined;
  let noOpen = false;
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        showHelp = true;
        break;
      case "--no-open":
        noOpen = true;
        break;
      case "--port": {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new Error("--port requires a value (e.g. --port 4321)");
        }
        const parsed = parseInt(next, 10);
        if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
          throw new Error(`--port must be a valid port number, got: ${next}`);
        }
        port = parsed;
        i += 1;
        break;
      }
      default:
        throw new Error(`Unknown option: ${arg}. Run 'rax cortex --help' for usage.`);
    }
  }

  return { port, noOpen, showHelp };
}

export async function runCortexCli(argv: readonly string[]): Promise<void> {
  let parsed: ReturnType<typeof parseCortexArgv>;
  try {
    parsed = parseCortexArgv(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(fail(message));
    process.exit(1);
  }

  if (parsed.showHelp) {
    printCortexHelp();
    return;
  }

  const port =
    parsed.port ?? parseInt(process.env.CORTEX_PORT ?? String(DEFAULT_PORT), 10);
  const noOpen = parsed.noOpen || process.env.CORTEX_NO_OPEN === "1";

  // Lazy-load: @reactive-agents/cortex is an optional peer dep (not declared in
  // package.json). When the user hasn't installed it, give a clear actionable error.
  type CortexModule = {
    startCortexServer: (config: {
      port: number;
      openBrowser: boolean;
      dbPath?: string;
      staticAssetsPath?: string;
    }) => Promise<void>;
  };
  let cortex: CortexModule;
  try {
    // Optional peer dep — not declared in package.json. May be missing at runtime.
    // The module-level dynamic import suppresses TS resolution and lets us catch failure.
    const moduleSpecifier = "@reactive-agents/cortex";
    cortex = (await import(moduleSpecifier)) as CortexModule;
  } catch {
    console.error(fail("rax cortex requires @reactive-agents/cortex."));
    console.error();
    console.error(info("Install it:"));
    console.error(info("  bun add @reactive-agents/cortex"));
    console.error();
    console.error(info("Or run from source repo:"));
    console.error(info("  bun cortex"));
    process.exit(1);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  banner("Cortex studio", "UI + API for visual agent inspection");
  console.log();
  console.log(kv("URL", baseUrl));
  console.log(kv("Ingest (WS)", `ws://127.0.0.1:${port}/ws/ingest`));
  console.log();
  console.log(info("Starting server… (Ctrl+C to stop)"));
  console.log();

  // Clean shutdown on SIGINT/SIGTERM. Bun listens forever, so we explicitly exit.
  const shutdown = (): void => {
    console.log();
    console.log(info("Shutting down cortex…"));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await cortex.startCortexServer({
    port,
    openBrowser: !noOpen,
    // staticAssetsPath auto-resolves inside startCortexServer to ../ui/build
    // relative to the bundled module — both source layout and npm-installed layout work.
  });
}
