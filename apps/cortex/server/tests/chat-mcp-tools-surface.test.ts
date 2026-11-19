/**
 * Selecting an MCP server for a chat session must put its tools on the agent's surface
 * (visible and callable) without the user also listing each tool in the `tools` allow-list.
 *
 * Regression pin: Cortex always sets `allowedTools` (meta tools at minimum). The runtime's
 * allow-list ToolService wrapper (`packages/runtime/src/runtime-tools-layer.ts`) used to hide
 * every MCP tool before `withAttachedMcpTools` could add attached servers' tools, so only an
 * explicitly named `server/tool` entry worked (the control case). The wrapper now applies the
 * same rule; these cases fail against a runtime dist without that fix.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { ChatStreamEvent as AgentStreamEvent } from "../services/chat-detached-turn.js";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { openDatabase } from "../db/schema.js";
import { insertMcpServer } from "../db/mcp-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";

const DB_PATH = tmpDbPath("chat-mcp-tools-surface");
const FIXTURE = join(import.meta.dir, "fixtures", "malformed-schema-mcp-server.ts");
const MCP_ID = "surface-fixture";

let db: ReturnType<typeof openDatabase>;
let svc: ChatSessionService;

beforeAll(() => {
  db = openDatabase(DB_PATH);
  insertMcpServer(db, MCP_ID, { name: "matrix", transport: "stdio", command: "bun", args: [FIXTURE] });
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmDbFiles(DB_PATH);
});

async function callEcho(extra: Record<string, unknown>): Promise<void> {
  const id = await svc.createSession({
    name: "surface",
    agentConfig: {
      provider: "test",
      model: "test-model",
      enableTools: true,
      askBeforeRiskyTools: false,
      strategy: "reactive",
      mcpServerIds: [MCP_ID],
      maxIterations: 6,
      testScenario: [
        { match: "use the echo tool", toolCall: { name: "matrix/echo", args: { text: "hello" } } },
        { match: "echo:hello", text: "The tool said hello." },
        { text: "Fallback reply." },
      ],
      ...extra,
    },
  });
  const events: AgentStreamEvent[] = [];
  for await (const e of svc.chatStream(id, "Please use the echo tool with hello.")) events.push(e);
  const done = events.find((e) => e._tag === "ToolCallCompleted");
  expect(done, JSON.stringify(events.map((e) => e._tag))).toBeDefined();
  expect(JSON.stringify(done)).toContain("echo:hello");
}

describe("chat MCP tool surface", () => {
  it("control: a tool named in the allow-list is callable", async () => {
    await callEcho({ tools: ["matrix/echo"] });
  }, 60_000);

  it("server only: MCP tool is callable", async () => {
    await callEcho({});
  }, 60_000);

  it("server + a built-in picked: MCP tool is callable", async () => {
    await callEcho({ tools: ["web-search"] });
  }, 60_000);

  it("server + terminal: MCP tool is callable", async () => {
    await callEcho({ terminalTools: true });
  }, 60_000);
});
