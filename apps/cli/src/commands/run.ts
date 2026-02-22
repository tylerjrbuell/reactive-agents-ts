import { ReactiveAgents } from "@reactive-agents/runtime";

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

interface MCPConfigFile {
  servers: Array<{
    name: string;
    transport: "stdio" | "sse" | "websocket";
    command?: string;
    args?: string[];
    endpoint?: string;
  }>;
}

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "gemini", "test"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

const PROVIDER_API_KEYS: Record<string, { env: string; label: string } | null> = {
  anthropic: { env: "ANTHROPIC_API_KEY", label: "Anthropic" },
  openai: { env: "OPENAI_API_KEY", label: "OpenAI" },
  gemini: { env: "GOOGLE_API_KEY", label: "Google" },
  ollama: null, // No API key needed
  test: null,
};

function isValidProvider(p: string): p is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(p);
}

/** Simple stderr spinner for long-running operations. */
function createSpinner(message: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stderr.write(`\r${frames[i++ % frames.length]} ${message}`);
  }, 80);
  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      process.stderr.write(`\r${finalMessage ?? `✓ ${message}`}\n`);
    },
    fail(finalMessage: string) {
      clearInterval(interval);
      process.stderr.write(`\r✗ ${finalMessage}\n`);
    },
  };
}

export async function runAgent(args: string[]): Promise<void> {
  // Parse arguments
  const promptParts: string[] = [];
  let provider: Provider = "anthropic";
  let model: string | undefined;
  let name = "cli-agent";
  let enableTools = false;
  let enableReasoning = false;
  let mcpConfigPath: string | undefined;
  let verbose = false;
  let quiet = false;
  let stream = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      const raw = args[++i];
      if (!isValidProvider(raw)) {
        console.error(`Unknown provider: "${raw}". Valid providers: ${VALID_PROVIDERS.join(", ")}`);
        process.exit(1);
      }
      provider = raw;
    } else if (arg === "--model" && args[i + 1]) {
      model = args[++i];
    } else if (arg === "--name" && args[i + 1]) {
      name = args[++i];
    } else if (arg === "--tools") {
      enableTools = true;
    } else if (arg === "--reasoning") {
      enableReasoning = true;
    } else if ((arg === "--mcp-config" || arg === "--mcp") && args[i + 1]) {
      mcpConfigPath = args[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (arg === "--quiet" || arg === "-q") {
      quiet = true;
    } else if (arg === "--stream") {
      stream = true;
    } else if (!arg.startsWith("--")) {
      promptParts.push(arg);
    }
  }

  const prompt = promptParts.join(" ");
  if (!prompt) {
    console.error("Usage: rax run <prompt> [options]\n");
    console.error("Options:");
    console.error("  --provider <name>    Provider: anthropic, openai, ollama, gemini, test");
    console.error("  --model <model>      Model identifier");
    console.error("  --name <name>        Agent name (default: cli-agent)");
    console.error("  --tools              Enable tool calling");
    console.error("  --reasoning          Enable reasoning strategies");
    console.error("  --mcp-config <path>  Path to MCP server config JSON");
    console.error("  --verbose, -v        Show phase-by-phase execution details");
    console.error("  --quiet, -q          Show only output (no metadata)");
    console.error("  --stream             Stream LLM output tokens");
    process.exit(1);
  }

  // Warn about unimplemented --stream flag
  if (stream) {
    console.error("Note: --stream is not yet implemented. Running without streaming.");
  }

  // Validate API key exists before building agent (fast fail)
  const keySpec = PROVIDER_API_KEYS[provider];
  if (keySpec && !process.env[keySpec.env]) {
    console.error(`Missing API key: ${keySpec.env} is not set.`);
    console.error(`Set it with: export ${keySpec.env}=<your-key>`);
    process.exit(1);
  }

  // Load MCP config: explicit path > auto-detect .rax/mcp.json
  let mcpConfig: MCPConfigFile | undefined;
  const configFile = mcpConfigPath ?? resolve(process.cwd(), ".rax", "mcp.json");
  if (mcpConfigPath || existsSync(configFile)) {
    try {
      const raw = readFileSync(mcpConfigPath ?? configFile, "utf-8");
      mcpConfig = JSON.parse(raw) as MCPConfigFile;
      if (!quiet) {
        console.log(`Loaded MCP config: ${mcpConfig.servers.length} server(s)`);
      }
    } catch (err) {
      if (mcpConfigPath) {
        console.error(`Failed to load MCP config from ${mcpConfigPath}: ${err}`);
        process.exit(1);
      }
    }
  }

  // Build agent
  const spinner = quiet ? null : createSpinner(`Building agent "${name}" with provider: ${provider}`);

  let builder = ReactiveAgents.create()
    .withName(name)
    .withProvider(provider);

  if (model) {
    builder = builder.withModel(model);
  }

  if (enableTools) {
    builder = builder.withTools();
  }

  if (enableReasoning) {
    builder = builder.withReasoning();
  }

  if (mcpConfig) {
    for (const server of mcpConfig.servers) {
      builder = builder.withMCP(server);
    }
  }

  try {
    const agent = await builder.build();
    spinner?.stop(`Agent ready: ${agent.agentId}`);

    if (verbose) {
      console.error(`  Provider: ${provider}`);
      if (model) console.error(`  Model: ${model}`);
      console.error(`  Tools: ${enableTools ? "enabled" : "disabled"}`);
      console.error(`  Reasoning: ${enableReasoning ? "enabled" : "disabled"}`);
      if (mcpConfig) console.error(`  MCP servers: ${mcpConfig.servers.length}`);
      console.error("");
    }

    if (!quiet) {
      console.error(`Running: "${prompt}"\n`);
    }

    const execSpinner = quiet ? null : createSpinner("Executing");
    const result = await agent.run(prompt);
    execSpinner?.stop("Execution complete");

    if (result.success) {
      if (quiet) {
        // Quiet mode: output only, no chrome
        console.log(result.output || "");
      } else {
        console.log("\n─── Output ───");
        console.log(result.output || "(no output)");
        console.log("\n─── Metadata ───");
        console.log(`  Duration: ${result.metadata.duration}ms`);
        console.log(`  Steps: ${result.metadata.stepsCount}`);
        console.log(`  Cost: $${result.metadata.cost.toFixed(6)}`);
        if (verbose && result.metadata.strategyUsed) {
          console.log(`  Strategy: ${result.metadata.strategyUsed}`);
        }
      }
    } else {
      console.error("Agent execution failed.");
      process.exit(1);
    }
  } catch (err) {
    spinner?.fail("Build failed");
    const msg = err instanceof Error ? err.message : String(err);
    // FiberFailure from Effect stores cause via [cause] symbol; check both
    const rawCause = err instanceof Error
      ? err.cause ?? (err as any)[Symbol.for("cause")]
      : undefined;
    const causeStr = rawCause
      ? `\n  Caused by: ${rawCause instanceof Error ? rawCause.message : String(rawCause)}`
      : "";
    console.error(`Error: ${msg}${causeStr}`);
    process.exit(1);
  }
}
