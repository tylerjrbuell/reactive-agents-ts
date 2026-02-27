/**
 * Example 06: MCP Filesystem Server
 *
 * Demonstrates connecting to a Model Context Protocol (MCP) filesystem server
 * via stdio transport. The agent can read and list files on the local filesystem.
 *
 * Prerequisites:
 *   npm install -g @modelcontextprotocol/server-filesystem
 *   # or use npx (auto-downloaded)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/tools/06-mcp-filesystem.ts
 *
 * Test mode (no MCP server launched, uses mock response):
 *   bun run apps/examples/src/tools/06-mcp-filesystem.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();
  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;
  const useReal = provider !== "test";

  console.log("\n=== MCP Filesystem Example ===");
  console.log(`Mode: ${useReal ? `LIVE (MCP + ${provider})` : "TEST (mock)"}\n`);

  let b = ReactiveAgents.create()
    .withName("mcp-filesystem-agent")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  const agent = await b
    .withTools()
    .withMCP(useReal ? [{
      name: "filesystem",
      transport: "stdio",
      command: "bunx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    }] : [])
    .withMaxIterations(5)
    .withTestResponses({
      "": "FINAL ANSWER: The /tmp directory contains temporary files managed by the operating system. MCP filesystem access is working.",
    })
    .build();

  const result = await agent.run("What files or directories are available? Give a brief summary.");

  console.log(`Output: ${result.output.slice(0, 200)}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);

  const passed = result.success && result.output.length > 10;
  return {
    passed,
    output: result.output.slice(0, 300),
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
