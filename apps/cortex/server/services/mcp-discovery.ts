/**
 * Ephemeral MCP connect + tools/list for Cortex “Refresh tools” (Tools tab).
 * Disconnects after discovery so the desk does not hold long-lived MCP transports.
 */
import { Effect } from "effect";
import { makeMCPClient } from "@reactive-agents/tools";
import type { MCPServerConfig } from "@reactive-agents/runtime";

export type DiscoveredMcpTool = { toolName: string; description?: string };

export function discoverMcpTools(config: MCPServerConfig): Promise<DiscoveredMcpTool[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* makeMCPClient;
      const server = yield* client.connect({
        name: config.name,
        transport: config.transport,
        endpoint: config.endpoint,
        command: config.command,
        args: config.args,
        cwd: config.cwd,
        env: config.env,
        headers: config.headers,
      });
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
      return out;
    }),
  );
}
