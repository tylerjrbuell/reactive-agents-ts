/**
 * A tiny MCP server over stdio for the docs screenshots: answers `initialize`, `tools/list`,
 * `ping`. Tools are fixed, so the Tools Lab shows the same names and schemas on every run.
 * Usage: bun run fake-mcp.ts <docs|issues>
 */
const kind = process.argv[2] === "issues" ? "issues" : "docs";

// `fail`: a server that cannot start, with a fixed message (the Failed state in the Tools Lab).
if (process.argv[2] === "fail") {
  process.stderr.write("billing-mcp: BILLING_API_KEY is not set\n");
  process.exit(1);
}

const TOOLS = {
  docs: [
    {
      name: "search_docs",
      description: "Full-text search over the product documentation.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Words to look for." }, limit: { type: "integer", minimum: 1, maximum: 20, default: 5 } },
        required: ["query"],
      },
    },
    {
      name: "get_page",
      description: "Return one documentation page as markdown.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Page path, for example guides/quickstart." } }, required: ["path"] },
    },
    { name: "list_sections", description: "List the top-level documentation sections.", inputSchema: { type: "object", properties: {} } },
  ],
  issues: [
    {
      name: "list_issues",
      description: "List open issues, newest first.",
      inputSchema: { type: "object", properties: { label: { type: "string" }, state: { type: "string", enum: ["open", "closed"], default: "open" } } },
    },
    {
      name: "create_issue",
      description: "Open a new issue.",
      inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] },
    },
  ],
} as const;

const reply = (id: unknown, result: unknown): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
};

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line === "") continue;
    let msg: { id?: unknown; method?: string };
    try {
      msg = JSON.parse(line) as { id?: unknown; method?: string };
    } catch {
      continue;
    }
    if (msg.id === undefined) continue; // notification
    if (msg.method === "initialize") {
      reply(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: `demo-${kind}`, version: "1.0.0" } });
    } else if (msg.method === "tools/list") {
      reply(msg.id, { tools: TOOLS[kind] });
    } else {
      reply(msg.id, {});
    }
  }
});
process.stdin.on("end", () => process.exit(0));
