/**
 * Minimal stdio MCP server for the chat strategy matrix. Exposes:
 *  - `echo`: a well-formed tool the scripted turn can call.
 *  - `run_funnel`: carries the Task 1 malformed schema (an `anyOf` array branch
 *    with no `items`), as the Umami MCP server does in the wild.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "matrix-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo back the given text.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "run_funnel",
      description: "Run a funnel over the given steps (malformed schema fixture).",
      inputSchema: { type: "object", properties: { steps: { anyOf: [{ type: "array" }, { type: "string" }] } } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as { text?: string };
  return { content: [{ type: "text", text: `echo:${args.text ?? ""}` }] };
});

await server.connect(new StdioServerTransport());
