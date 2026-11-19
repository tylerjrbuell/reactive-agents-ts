/**
 * Minimal stdio MCP server whose tools carry MCP annotations. Used by
 * seam-mcp-approval-gate.test.ts.
 *
 * - `wipe`: `destructiveHint: true` (writes; must be gated under a policy)
 * - `peek`: no annotations (the test's server config declares it read-only)
 * - `echo`: no annotations, no declaration (effect unknown)
 * - `sites`: declares an `outputSchema` and returns matching structuredContent
 *
 * Also used by packages/tools/tests/mcp/output-schema-return-type.test.ts.
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
const sitesOutputSchema = {
  type: "object",
  properties: {
    websites: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, domain: { type: "string" } },
        required: ["id", "name"],
      },
    },
    total: { type: "integer" },
  },
  required: ["websites", "total"],
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: "wipe", description: "Delete every record.", inputSchema: noArgs, annotations: { destructiveHint: true } },
    { name: "peek", description: "Read the record count.", inputSchema: noArgs },
    { name: "echo", description: "Echo a fixed string.", inputSchema: noArgs },
    { name: "sites", description: "List tracked websites.", inputSchema: noArgs, outputSchema: sitesOutputSchema },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const log = process.env.MCP_FIXTURE_CALL_LOG;
  if (log) appendFileSync(log, `${req.params.name}\n`);
  if (req.params.name === "sites") {
    // Per MCP spec: structuredContent plus its JSON serialization as text.
    const structuredContent = { websites: [{ id: "w1", name: "docs", domain: "example.org" }], total: 1 };
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
  }
  return { content: [{ type: "text", text: `${req.params.name}:ok` }] };
});

await server.connect(new StdioServerTransport());
