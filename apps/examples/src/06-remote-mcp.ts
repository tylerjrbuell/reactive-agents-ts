/**
 * Example 06: Remote MCP Server
 *
 * Demonstrates connecting to an MCP (Model Context Protocol) server:
 * - Uses the builder's .withMCP() to configure MCP server connections
 * - Shows both stdio (local process) and SSE (remote HTTP) transport configs
 * - Agent discovers and uses tools from the MCP server
 *
 * Usage:
 *   bun run apps/examples/src/06-remote-mcp.ts
 *
 * Note: This example shows the configuration API. For a real MCP server,
 * you would need an actual MCP-compatible server running.
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

console.log("=== Reactive Agents: Remote MCP Server Example ===\n");

// ─── Example 1: Stdio MCP transport (local process) ───

console.log("--- Configuration Example 1: Stdio Transport ---");
console.log("Connect to a local MCP server via stdio (e.g., a Python script):\n");

const stdioConfig = {
  name: "local-tools",
  transport: "stdio" as const,
  command: "python3",
  args: ["-m", "my_mcp_server"],
};

console.log(`  Server: ${stdioConfig.name}`);
console.log(`  Transport: ${stdioConfig.transport}`);
console.log(`  Command: ${stdioConfig.command} ${stdioConfig.args.join(" ")}\n`);

// ─── Example 2: SSE MCP transport (remote HTTP) ───

console.log("--- Configuration Example 2: SSE Transport ---");
console.log("Connect to a remote MCP server via Server-Sent Events:\n");

const sseConfig = {
  name: "remote-tools",
  transport: "sse" as const,
  endpoint: "https://mcp-server.example.com/sse",
};

console.log(`  Server: ${sseConfig.name}`);
console.log(`  Transport: ${sseConfig.transport}`);
console.log(`  Endpoint: ${sseConfig.endpoint}\n`);

// ─── Build an agent with MCP configuration ───

console.log("--- Building Agent with MCP ---\n");

// Note: In test mode, MCP servers are not actually connected,
// but the builder API accepts the configuration
const agent = await ReactiveAgents.create()
  .withName("mcp-agent")
  .withProvider("test")
  .withTestResponses({
    "": "I would use the available MCP tools to help answer your question. The connected MCP servers provide additional capabilities.",
  })
  .withMCP([
    // In a real scenario, these would be actual MCP servers:
    // stdioConfig,
    // sseConfig,
  ])
  .withMaxIterations(3)
  .build();

console.log(`Agent built: ${agent.agentId}`);
console.log("MCP configuration accepted by builder.\n");

// ─── Run the agent ───

const result = await agent.run("What tools do you have available?");

console.log("--- Result ---");
console.log(`Success: ${result.success}`);
console.log(`Output: ${result.output}`);

console.log("\n--- MCP Config File Format ---");
console.log("You can also use a .rax/mcp.json config file:\n");
console.log(JSON.stringify({
  servers: [
    { name: "local-tools", transport: "stdio", command: "python3", args: ["-m", "my_mcp_server"] },
    { name: "remote-api", transport: "sse", endpoint: "https://mcp-server.example.com/sse" },
  ],
}, null, 2));

console.log("\nThen run: rax run 'query' --mcp-config .rax/mcp.json");
console.log("\nDone.");
