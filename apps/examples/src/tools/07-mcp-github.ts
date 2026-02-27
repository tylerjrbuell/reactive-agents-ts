/**
 * Example 07: MCP GitHub Server
 *
 * Demonstrates connecting to the MCP GitHub server via stdio transport.
 * The agent can query GitHub repositories, issues, and pull requests.
 *
 * Prerequisites:
 *   GITHUB_PERSONAL_ACCESS_TOKEN=ghp_... (GitHub token with repo read access)
 *   npm install -g @modelcontextprotocol/server-github
 *   # or use npx (auto-downloaded)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... GITHUB_PERSONAL_ACCESS_TOKEN=ghp_... \
 *     bun run apps/examples/src/tools/07-mcp-github.ts
 *
 * Test mode (no MCP server, uses mock):
 *   bun run apps/examples/src/tools/07-mcp-github.ts
 *
 * Note: The GITHUB_PERSONAL_ACCESS_TOKEN must be set in the environment before
 * launching this process. The MCP GitHub server reads it from the inherited
 * process environment automatically.
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
  const useReal = provider !== "test" && Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN);

  console.log("\n=== MCP GitHub Example ===");
  console.log(`Mode: ${useReal ? `LIVE (MCP GitHub + ${provider})` : "TEST (mock)"}\n`);

  let b = ReactiveAgents.create()
    .withName("mcp-github-agent")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);
  const agent = await b
    .withTools()
    .withMCP(useReal ? [{
      name: "github",
      transport: "stdio",
      command: "bunx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    }] : [])
    .withMaxIterations(5)
    .withTestResponses({
      "": "FINAL ANSWER: The octocat/Hello-World repository is a public demo repository on GitHub used for testing. It has several open issues and is widely forked.",
    })
    .build();

  const result = await agent.run(
    "Using the GitHub tools, briefly describe the octocat/Hello-World repository."
  );

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
