/** Minimal stdio MCP server: one `echo` tool. Used by mcp-tools-vs-allowedtools.test.ts. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "echo-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo back the given text.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
    {
      name: "shout",
      description: "Echo back the given text, upper-cased.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as { text?: string };
  const text = args.text ?? "";
  return { content: [{ type: "text", text: req.params.name === "shout" ? text.toUpperCase() : `echo:${text}` }] };
});

await server.connect(new StdioServerTransport());
