import { ReactiveAgents } from "@reactive-agents/runtime";
import chalk from "chalk";

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { createSpinner, kv, muted, divider, fail } from "../ui.js";

interface MCPConfigFile {
  servers: Array<{
    name: string;
    transport: "stdio" | "sse" | "websocket";
    command?: string;
    args?: string[];
    endpoint?: string;
  }>;
}

function readErrorCause(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  if (err.cause !== undefined) {
    return err.cause instanceof Error ? err.cause.message : String(err.cause);
  }
  const symbolCause = Reflect.get(err, Symbol.for("cause"));
  if (symbolCause === undefined) return undefined;
  return symbolCause instanceof Error ? symbolCause.message : String(symbolCause);
}

const VALID_PROVIDERS = ["anthropic", "openai", "ollama", "gemini", "litellm", "test"] as const;
type Provider = (typeof VALID_PROVIDERS)[number];

const PROVIDER_API_KEYS: Record<string, { env: string; label: string } | null> = {
  anthropic: { env: "ANTHROPIC_API_KEY", label: "Anthropic" },
  openai: { env: "OPENAI_API_KEY", label: "OpenAI" },
  gemini: { env: "GOOGLE_API_KEY", label: "Google" },
  litellm: null, // Uses LITELLM_BASE_URL + optional LITELLM_API_KEY
  ollama: null, // No API key needed
  test: null,
};

function isValidProvider(p: string): p is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(p);
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
    console.error("  --provider <name>    Provider: anthropic, openai, ollama, gemini, litellm, test");
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
  const spin = quiet ? null : createSpinner(`Building agent "${name}" with provider: ${provider}`);

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
    spin?.stop(`Agent ready: ${agent.agentId}`);

    if (verbose) {
      console.log(kv("Provider", provider));
      if (model) console.log(kv("Model", model));
      console.log(kv("Tools", enableTools ? "enabled" : "disabled"));
      console.log(kv("Reasoning", enableReasoning ? "enabled" : "disabled"));
      if (mcpConfig) console.log(kv("MCP servers", String(mcpConfig.servers.length)));
      console.log("");
    }

    if (!quiet) {
      console.error(`Running: "${prompt}"\n`);
    }

    const execSpin = quiet || stream ? null : createSpinner("Executing...");
    const result = stream
      ? await (async () => {
          if (!quiet) {
            console.log("\n─── Streaming Output ───");
          }

          let output = "";
          let streamError: string | null = null;
          let finalMetadata:
            | {
                duration: number;
                stepsCount: number;
                cost: number;
                strategyUsed?: string;
              }
            | undefined;

          for await (const event of agent.runStream(prompt)) {
            switch (event._tag) {
              case "TextDelta":
                process.stdout.write(event.text);
                output += event.text;
                break;
              case "StreamCompleted":
                finalMetadata = event.metadata;
                if (!quiet) {
                  process.stdout.write("\n");
                }
                break;
              case "StreamError":
                streamError = event.cause;
                break;
            }
          }

          if (streamError !== null) {
            return {
              success: false,
              output,
              metadata: {
                duration: 0,
                stepsCount: 0,
                cost: 0,
              },
              error: streamError,
            };
          }

          return {
            success: true,
            output,
            metadata:
              finalMetadata ?? {
                duration: 0,
                stepsCount: 0,
                cost: 0,
              },
          };
        })()
      : await agent.run(prompt);
    execSpin?.stop("Execution complete");

    if (result.success) {
      if (quiet) {
        // Quiet mode: output only, no chrome
        console.log(result.output || "");
      } else {
        console.log("");
        divider();
        console.log(chalk.bold("\nOutput:"));
        console.log(result.output || muted("(no output)"));
        console.log("");
        divider();
        console.log(chalk.bold("\nMetrics:"));
        console.log(kv("Duration", `${result.metadata.duration}ms`));
        console.log(kv("Steps", String(result.metadata.stepsCount)));
        console.log(kv("Cost", `$${result.metadata.cost.toFixed(6)}`));
        if (verbose && result.metadata.strategyUsed) {
          console.log(kv("Strategy", result.metadata.strategyUsed));
        }
      }
    } else {
      const errorDetail = "error" in result ? result.error : undefined;
      console.error(`Agent execution failed.${errorDetail ? ` ${errorDetail}` : ""}`);
      process.exit(1);
    }
  } catch (err) {
    spin?.fail("Build failed");
    const msg = err instanceof Error ? err.message : String(err);
    const cause = readErrorCause(err);
    const causeStr = cause
      ? `\n  Caused by: ${cause}`
      : "";
    console.error(`Error: ${msg}${causeStr}`);
    process.exit(1);
  }
}
