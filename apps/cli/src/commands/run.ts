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

export async function runAgent(args: string[]): Promise<void> {
  // Parse arguments
  const promptParts: string[] = [];
  let provider: "anthropic" | "openai" | "ollama" | "gemini" | "test" = "anthropic";
  let model: string | undefined;
  let name = "cli-agent";
  let enableTools = false;
  let enableReasoning = false;
  let mcpConfigPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider" && args[i + 1]) {
      provider = args[++i] as typeof provider;
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
    } else if (!arg.startsWith("--")) {
      promptParts.push(arg);
    }
  }

  const prompt = promptParts.join(" ");
  if (!prompt) {
    console.error("Usage: rax run <prompt> [--provider anthropic|openai|ollama|gemini|test] [--model <model>] [--name <name>] [--tools] [--reasoning] [--mcp-config <path>]");
    process.exit(1);
  }

  // Load MCP config: explicit path > auto-detect .rax/mcp.json
  let mcpConfig: MCPConfigFile | undefined;
  const configFile = mcpConfigPath ?? resolve(process.cwd(), ".rax", "mcp.json");
  if (mcpConfigPath || existsSync(configFile)) {
    try {
      const raw = readFileSync(mcpConfigPath ?? configFile, "utf-8");
      mcpConfig = JSON.parse(raw) as MCPConfigFile;
      console.log(`Loaded MCP config: ${mcpConfig.servers.length} server(s)`);
    } catch (err) {
      if (mcpConfigPath) {
        console.error(`Failed to load MCP config from ${mcpConfigPath}: ${err}`);
        process.exit(1);
      }
    }
  }

  console.log(`Building agent "${name}" with provider: ${provider}...`);

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
    console.log(`Agent ready: ${agent.agentId}`);
    console.log(`Running: "${prompt}"\n`);

    const result = await agent.run(prompt);

    if (result.success) {
      console.log("─── Output ───");
      console.log(result.output || "(no output)");
      console.log("\n─── Metadata ───");
      console.log(`  Duration: ${result.metadata.duration}ms`);
      console.log(`  Steps: ${result.metadata.stepsCount}`);
      console.log(`  Cost: $${result.metadata.cost.toFixed(6)}`);
    } else {
      console.error("Agent execution failed.");
      process.exit(1);
    }
  } catch (err) {
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
