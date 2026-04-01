import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { banner, hint, info, kv, warn, fail, section } from "../ui.js";

const DEFAULT_PORT = 4321;

export interface CortexCommandOptions {
  readonly port?: number;
  readonly noOpen?: boolean;
  /** Run SvelteKit dev UI + API (same as `apps/cortex` → `bun start`). */
  readonly dev?: boolean;
}

/** Shown for `rax cortex --help` and referenced from main `rax help`. */
export function printCortexHelp(): void {
  console.log(`
${section("rax cortex — Companion studio")}
  Start the Cortex Bun server: static UI (when built), REST API, WebSocket ingest
  for agents using ReactiveAgents.withCortex().

${section("Usage")}
  rax cortex [options]

${section("Options")}
  --port <n>     API listen port (default: ${DEFAULT_PORT}, or env CORTEX_PORT)
  --dev          Start API + Vite dev UI together (same as apps/cortex bun start)
  --no-open      Do not open a browser on start (or set CORTEX_NO_OPEN=1)
  -h, --help     Show this help

${section("Environment")}
  CORTEX_PORT       Server port (default ${DEFAULT_PORT})
  CORTEX_NO_OPEN    Set to 1 to skip opening the browser
  CORTEX_URL        Base URL agents use to reach ingest (set automatically for this server)
  CORTEX_STATIC_PATH  Override path to built UI (folder with index.html)

${section("UI")}
  • rax cortex --dev     API + Vite (open http://localhost:5173 — proxies /api and /ws)
  • Bundled UI:          cd apps/cli && bun run build:cortex-ui  then rax cortex (no --dev)
  • Manual dev UI only: cd apps/cortex/ui && bun run dev  (API must run separately)

${section("With rax run")}
  In another terminal:
  rax run "Your task" --cortex --provider anthropic
  Ensure CORTEX_URL matches this server (default http://127.0.0.1:${DEFAULT_PORT}).
`.trimEnd());
  console.log();
}

function parsePort(raw: string): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    console.error(fail(`Invalid --port: "${raw}" (use 1–65535)`));
    process.exit(1);
  }
  return n;
}

/**
 * Parse argv after `rax cortex`. Handles --help; exits on unknown flags.
 */
export function parseCortexArgv(argv: readonly string[]): CortexCommandOptions & { readonly showHelp: boolean } {
  if (argv.length === 0) {
    return { showHelp: false, noOpen: false, dev: false };
  }
  const first = argv[0];
  if (first === "--help" || first === "-h" || first === "help") {
    return { showHelp: true, noOpen: false, dev: false };
  }

  let port: number | undefined;
  let noOpen = false;
  let dev = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        console.error(fail("--port requires a number"));
        process.exit(1);
      }
      i++;
      port = parsePort(next);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--dev") {
      dev = true;
    } else if (arg.startsWith("--")) {
      console.error(fail(`Unknown option: ${arg}`));
      console.error(info("Run: rax cortex --help"));
      process.exit(1);
    } else {
      console.error(fail(`Unexpected argument: ${arg}`));
      console.error(info("Run: rax cortex --help"));
      process.exit(1);
    }
  }

  return { port, noOpen, dev, showHelp: false };
}

/**
 * Entry for `rax cortex` — parses argv, may print help and return.
 */
export async function runCortexCli(argv: readonly string[]): Promise<void> {
  const parsed = parseCortexArgv(argv);
  if (parsed.showHelp) {
    printCortexHelp();
    return;
  }
  await cortexCommand({ port: parsed.port, noOpen: parsed.noOpen, dev: parsed.dev });
}

const DEFAULT_VITE_URL = "http://localhost:5173";

function envForCortexChild(
  base: NodeJS.ProcessEnv,
  opts: { stripStaticPath: boolean },
): NodeJS.ProcessEnv {
  if (!opts.stripStaticPath) return { ...base };
  const { CORTEX_STATIC_PATH: _removed, ...rest } = base;
  return rest;
}

/**
 * API + Vite dev UI — runs `apps/cortex/scripts/dev-stack.ts` (same as `bun start` there).
 */
async function cortexDevStack(options: {
  readonly port: number;
  readonly baseUrl: string;
}): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const cortexRoot = path.resolve(__dirname, "../../../cortex");
  const stackScript = path.join(cortexRoot, "scripts/dev-stack.ts");

  if (!existsSync(stackScript)) {
    console.error(fail(`Cortex dev stack not found:\n  ${stackScript}`));
    process.exit(1);
  }

  banner("Cortex studio (dev)", "API + SvelteKit / Vite — same as apps/cortex bun start");
  console.log();
  console.log(kv("API", options.baseUrl));
  console.log(kv("Ingest (WS)", `ws://127.0.0.1:${options.port}/ws/ingest`));
  console.log(kv("UI (Vite)", `${DEFAULT_VITE_URL}  (proxies /api and /ws to API)`));
  console.log(kv("CORTEX_URL", `(for children) ${options.baseUrl}`));
  console.log();
  console.log(info("Starting dev stack… Ctrl+C stops API and UI"));
  console.log();

  const proc = Bun.spawn(["bun", "run", stackScript], {
    cwd: cortexRoot,
    env: {
      ...envForCortexChild(process.env, { stripStaticPath: true }),
      CORTEX_PORT: String(options.port),
      CORTEX_URL: process.env.CORTEX_URL?.trim() || options.baseUrl,
      CORTEX_NO_OPEN: "1",
      CORTEX_SPAWNED_BY_RAX: "1",
    },
    stdio: ["inherit", "inherit", "inherit"],
  });

  const shutdown = () => {
    proc.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await proc.exited;
}

/**
 * Start the Cortex Bun server, optional static UI from CLI assets, or `--dev` for Vite + API.
 */
export async function cortexCommand(options: CortexCommandOptions = {}): Promise<void> {
  const port = options.port ?? parseInt(process.env.CORTEX_PORT ?? String(DEFAULT_PORT), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(fail(`Invalid port: ${port}`));
    process.exit(1);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serverEntry = path.resolve(__dirname, "../../../cortex/server/index.ts");
  const staticPath = path.resolve(__dirname, "../../assets/cortex");
  const hasStatic = existsSync(path.join(staticPath, "index.html"));

  if (!existsSync(serverEntry)) {
    console.error(fail(`Cortex server entry not found:\n  ${serverEntry}`));
    process.exit(1);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const ingestWs = `ws://127.0.0.1:${port}/ws/ingest`;

  if (options.dev) {
    await cortexDevStack({ port, baseUrl });
    return;
  }

  banner("Cortex studio", "UI + runs API + event ingest for .withCortex()");
  console.log();
  console.log(kv("URL", baseUrl));
  console.log(kv("Ingest (WS)", ingestWs));
  console.log(kv("CORTEX_URL", `(set for child process) ${baseUrl}`));
  console.log();

  if (!hasStatic) {
    console.log(warn(`Static UI not found: ${path.join(staticPath, "index.html")}`));
    console.log(hint("Use: rax cortex --dev   (Vite + API)"));
    console.log(hint("Or:  cd apps/cli && bun run build:cortex-ui"));
    console.log();
  }

  console.log(info("Starting server… (Ctrl+C to stop)"));
  console.log();

  const proc = Bun.spawn(["bun", "run", serverEntry], {
    env: {
      ...process.env,
      CORTEX_PORT: String(port),
      CORTEX_NO_OPEN: options.noOpen ? "1" : process.env.CORTEX_NO_OPEN ?? "0",
      CORTEX_URL: process.env.CORTEX_URL?.trim() || baseUrl,
      /** Suppress duplicate “◈ CORTEX running” — parent CLI already printed endpoints. */
      CORTEX_SPAWNED_BY_RAX: "1",
      ...(hasStatic ? { CORTEX_STATIC_PATH: staticPath } : {}),
    },
    stdio: ["inherit", "inherit", "inherit"],
  });

  const shutdown = () => {
    proc.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await proc.exited;
}
