/**
 * Minimal stdio MCP server whose tools carry MCP annotations. Used by
 * seam-mcp-approval-gate.test.ts.
 *
 * - `wipe`: `destructiveHint: true` (writes; must be gated under a policy)
 * - `peek`: no annotations (the test's server config declares it read-only)
 * - `echo`: no annotations, no declaration (effect unknown)
 *
 * Every call appends `<tool>\n` to the file named by `MCP_FIXTURE_CALL_LOG`, so
 * the test sees which tools ACTUALLY ran in this child process.
 */
import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "annotated-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
const noArgs = { type: "object", properties: {} };

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "wipe", description: "Delete every record.", inputSchema: noArgs, annotations: { destructiveHint: true } },
    { name: "peek", description: "Read the record count.", inputSchema: noArgs },
    { name: "echo", description: "Echo a fixed string.", inputSchema: noArgs },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const log = process.env.MCP_FIXTURE_CALL_LOG;
  if (log) appendFileSync(log, `${req.params.name}\n`);
  return { content: [{ type: "text", text: `${req.params.name}:ok` }] };
});

await server.connect(new StdioServerTransport());
