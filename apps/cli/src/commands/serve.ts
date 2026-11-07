import { ReactiveAgents, type ReactiveAgent } from "@reactive-agents/runtime";
import { banner, kv, success, fail, info, muted, box } from "../ui.js";
import { VALID_PROVIDERS, isValidProvider, providerList, type Provider } from "../providers.js";

const HELP = `
  Usage: rax serve [options]

  Start an agent as an A2A server

  Options:
    --port <number>      Port for A2A server (default: 3000)
    --name <string>     Agent name (default: "agent")
    --provider <name>   LLM provider: ${providerList("|")} (default: test)
    --model <string>    Model name
    --with-tools        Enable tools
    --with-reasoning    Enable reasoning strategies
    --with-memory [enhanced]   Enable memory (basic by default; pass "enhanced" for tier 2)
    --help              Show this help
`.trimEnd();

export async function runServe(argv: string[]) {
  const args = argv.slice();

  if (args.includes("--help") || args.includes("-h")) {
    box(HELP, { title: " rax serve " });
    return;
  }

  let port = 3000;
  let name = "agent";
  let provider: Provider = "test";
  let model: string | undefined;
  let withTools = false;
  let withReasoning = false;
  let enableMemory = false;
  let memoryEnhanced = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--port":
        port = parseInt(args[++i], 10);
        break;
      case "--name":
        name = args[++i];
        break;
      case "--provider":
        if (!args[i + 1]) {
          console.error(fail("Missing value for --provider"));
          process.exit(1);
        }
        {
          const raw = args[++i];
          if (!isValidProvider(raw)) {
            console.error(fail(`Unknown provider: "${raw}". Valid providers: ${VALID_PROVIDERS.join(", ")}`));
            process.exit(1);
          }
          provider = raw;
        }
        break;
      case "--model":
        model = args[++i];
        break;
      case "--with-tools":
        withTools = true;
        break;
      case "--with-reasoning":
        withReasoning = true;
        break;
      case "--with-memory":
        enableMemory = true;
        if (args[i + 1] === "enhanced" || args[i + 1] === "2") {
          memoryEnhanced = true;
          i++;
        } else if (args[i + 1] === "1" || args[i + 1] === "basic") {
          i++;
        }
        break;
    }
  }

  banner("rax serve", `Starting A2A server: ${name}`);
  console.log(kv("Port", String(port)));
  console.log(kv("Provider", `${provider}${model ? ` (${model})` : ""}`));
  console.log(kv("Tools", withTools ? "enabled" : "disabled"));
  console.log(kv("Reasoning", withReasoning ? "enabled" : "disabled"));
  console.log(kv("Memory", enableMemory ? (memoryEnhanced ? "enhanced" : "basic") : "disabled"));

  let builder = ReactiveAgents.create()
    .withName(name)
    .withProvider(provider)
    .withModel(model ?? "test")
    .withA2A({ port });

  if (withTools) builder = builder.withTools();
  if (withReasoning) builder = builder.withReasoning();
  if (enableMemory) builder = memoryEnhanced ? builder.withMemory({ tier: "enhanced" }) : builder.withMemory();

  // Build the agent and start the A2A server. Awaited so a rejection from
  // either the build step or `agent.serveA2A()` itself (e.g. EADDRINUSE, a
  // `secureServe` non-loopback refusal) surfaces through the command's
  // normal `fail(...)` + exit path instead of becoming an unhandled promise
  // rejection (final-review Minor #3).
  await startServer(builder.build(), name, port);
}

/**
 * Reads a CLI-facing env var, falling back to its deprecated predecessor with
 * a one-line stderr warning. `RA_SERVE_*` was the CLI's own ad-hoc naming from
 * when it hand-rolled its server; `RA_A2A_*` (read directly by
 * `agent.serveA2A()` / `packages/a2a`'s HTTP server) is now canonical since it
 * names the protocol, not the command. Kept as a fallback, not dropped,
 * because these are user-facing env vars that existing deployments may set.
 */
function readEnvWithDeprecatedFallback(canonical: string, deprecated: string): string | undefined {
  if (process.env[canonical] !== undefined) return process.env[canonical];
  if (process.env[deprecated] !== undefined) {
    console.error(fail(`${deprecated} is deprecated; use ${canonical} instead.`));
    return process.env[deprecated];
  }
  return undefined;
}

async function startServer(
  agentPromise: Promise<ReactiveAgent>,
  name: string,
  port: number,
) {
  let agent: ReactiveAgent;
  try {
    agent = await agentPromise;
  } catch (err) {
    console.error(fail(`Failed to build agent: ${err}`));
    process.exit(1);
  }

  const hostname = readEnvWithDeprecatedFallback("RA_A2A_HOST", "RA_SERVE_HOST");
  const token = readEnvWithDeprecatedFallback("RA_A2A_TOKEN", "RA_SERVE_TOKEN");

  let handle: Awaited<ReturnType<ReactiveAgent["serveA2A"]>>;
  try {
    handle = await agent.serveA2A({
      port,
      description: `A2A agent: ${name}`,
      hostname,
      token,
    });
  } catch (err) {
    console.error(fail(`Failed to start A2A server: ${err}`));
    process.exit(1);
  }

  const boundHost = hostname ?? "127.0.0.1";
  console.log("");
  console.log(success(`A2A server ready on port ${handle.port}`));
  console.log(kv("Agent Card", `http://${boundHost}:${handle.port}/.well-known/agent.json`));
  console.log(kv("JSON-RPC", `http://${boundHost}:${handle.port}/`));
  console.log(muted("\nUse Ctrl+C to stop"));

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log(info("Shutting down A2A server..."));
    handle.stop().then(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    handle.stop().then(() => process.exit(0));
  });
}
