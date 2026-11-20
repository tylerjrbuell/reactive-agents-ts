/**
 * Ephemeral MCP connect + tools/list for Cortex “Refresh tools” (Tools tab).
 * Disconnects after discovery so the desk does not hold long-lived MCP transports.
 */
import { Effect } from "effect";
import { makeMCPClient } from "@reactive-agents/tools";
import type { MCPServerConfig } from "@reactive-agents/runtime";
import { cortexLog } from "../cortex-log.js";

export type DiscoveredMcpTool = {
  toolName: string;
  description?: string;
  /** The tool's JSON Schema input as the server reported it. */
  inputSchema?: Record<string, unknown>;
};

export function discoverMcpTools(config: MCPServerConfig): Promise<DiscoveredMcpTool[]> {
  // Name and transport only: endpoints and command lines often carry tokens in the query string or args.
  cortexLog("info", "mcp", `discover "${config.name}" transport=${config.transport}`);
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeMCPClient;
      const server = yield* client.connect({
        name: config.name,
        ...(config.transport !== undefined ? { transport: config.transport } : {}),
        ...(config.endpoint !== undefined ? { endpoint: config.endpoint } : {}),
        ...(config.command !== undefined ? { command: config.command } : {}),
        ...(config.args !== undefined ? { args: config.args } : {}),
        ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
        ...(config.env !== undefined ? { env: config.env } : {}),
        ...(config.headers !== undefined ? { headers: config.headers } : {}),
        // The saved OAuth config (e.g. a static authorization_code client) is what an agent connects
        // with, so Test / Refresh use it too; without it a URL-only server uses a stored login.
        ...(config.auth !== undefined ? { auth: config.auth } : {}),
      } as Parameters<typeof client.connect>[0]);
      const schemas = server.toolSchemas ?? [];
      const out: DiscoveredMcpTool[] = [];
      for (let i = 0; i < server.tools.length; i++) {
        const raw = server.tools[i];
        const toolName = `${server.name}/${raw}`;
        const description = schemas[i]?.description;
        const inputSchema = schemas[i]?.inputSchema;
        out.push({
          toolName,
          ...(description !== undefined && description !== "" ? { description } : {}),
          ...(inputSchema !== undefined && inputSchema !== null ? { inputSchema } : {}),
        });
      }
      yield* client.disconnect(server.name);
      yield* Effect.logInfo(`[MCP discover] "${config.name}" → ${out.length} tool(s) cached`);
      return out;
    }),
  ).catch((err: unknown) => {
    cortexLog("error", "mcp", `discover "${config.name}" FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  });
}
