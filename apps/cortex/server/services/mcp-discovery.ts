/**
 * Ephemeral MCP connect + tools/list for Cortex “Refresh tools” (Tools tab).
 * Disconnects after discovery so the desk does not hold long-lived MCP transports.
 */
import { Effect } from "effect";
import { makeMCPClient } from "@reactive-agents/tools";
import type { MCPServerConfig } from "@reactive-agents/runtime";

export type DiscoveredMcpTool = { toolName: string; description?: string };

export function discoverMcpTools(config: MCPServerConfig): Promise<DiscoveredMcpTool[]> {
  console.log(`[MCP discover] "${config.name}" transport=${config.transport}${config.endpoint ? ` endpoint=${config.endpoint}` : ""}${config.command ? ` command=${config.command}` : ""}`);
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
      } as Parameters<typeof client.connect>[0]);
      const schemas = server.toolSchemas ?? [];
      const out: DiscoveredMcpTool[] = [];
      for (let i = 0; i < server.tools.length; i++) {
        const raw = server.tools[i];
        const toolName = `${server.name}/${raw}`;
        const description = schemas[i]?.description;
        out.push(
          description !== undefined && description !== ""
            ? { toolName, description }
            : { toolName },
        );
      }
      yield* client.disconnect(server.name);
      console.log(`[MCP discover] "${config.name}" → ${out.length} tool(s) cached`);
      return out;
    }),
  ).catch((err: unknown) => {
    console.error(`[MCP discover] "${config.name}" FAILED:`, err instanceof Error ? err.message : String(err));
    throw err;
  });
}
