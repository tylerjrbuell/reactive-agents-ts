import { Effect, Ref } from "effect";

import type { MCPServer, MCPRequest, MCPResponse } from "../types.js";
import { MCPConnectionError, ToolExecutionError } from "../errors.js";

// ─── Transport Creation (stub - real implementation varies by transport) ───

const createTransport = (
  _config: Pick<
    MCPServer,
    "name" | "transport" | "endpoint" | "command" | "args"
  >,
): Effect.Effect<void, unknown> => Effect.void;

// ─── JSON-RPC request sender (stub) ───

const sendRequest = (
  _config: Pick<MCPServer, "name" | "transport" | "endpoint" | "command">,
  request: MCPRequest,
): Effect.Effect<MCPResponse, MCPConnectionError> =>
  Effect.succeed({
    jsonrpc: "2.0" as const,
    id: request.id,
    result: {},
  });

export const makeMCPClient = Effect.gen(function* () {
  const serversRef = yield* Ref.make<Map<string, MCPServer>>(new Map());
  const requestIdRef = yield* Ref.make(0);

  const nextRequestId = Ref.updateAndGet(requestIdRef, (id) => id + 1);

  const connect = (
    config: Pick<
      MCPServer,
      "name" | "transport" | "endpoint" | "command" | "args"
    >,
  ): Effect.Effect<MCPServer, MCPConnectionError> =>
    Effect.gen(function* () {
      // Step 1: Establish connection based on transport
      yield* createTransport(config).pipe(
        Effect.mapError(
          (e) =>
            new MCPConnectionError({
              message: `Failed to connect to MCP server "${config.name}"`,
              serverName: config.name,
              transport: config.transport,
              cause: e,
            }),
        ),
      );

      // Step 2: Initialize protocol (send initialize request)
      const reqId1 = yield* nextRequestId;
      const initResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: reqId1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "reactive-agents", version: "1.0.0" },
        },
      });

      // Step 3: Discover available tools
      const reqId2 = yield* nextRequestId;
      const toolsResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: reqId2,
        method: "tools/list",
      });

      const toolNames = Array.isArray(toolsResponse.result)
        ? toolsResponse.result.map(
            (t: Record<string, unknown>) => t.name as string,
          )
        : [];

      const server: MCPServer = {
        name: config.name,
        version:
          (initResponse.result as Record<string, unknown>)?.serverInfo !=
          null
            ? String(
                (
                  (initResponse.result as Record<string, unknown>)
                    .serverInfo as Record<string, unknown>
                )?.version,
              )
            : "unknown",
        transport: config.transport,
        endpoint: config.endpoint,
        command: config.command,
        args: config.args,
        tools: toolNames,
        status: "connected",
      };

      yield* Ref.update(serversRef, (servers) => {
        const newServers = new Map(servers);
        newServers.set(server.name, server);
        return newServers;
      });

      return server;
    });

  const callTool = (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, MCPConnectionError | ToolExecutionError> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      const server = servers.get(serverName);

      if (!server || server.status !== "connected") {
        return yield* Effect.fail(
          new MCPConnectionError({
            message: `MCP server "${serverName}" not connected`,
            serverName,
            transport: server?.transport ?? "unknown",
          }),
        );
      }

      const reqId = yield* nextRequestId;
      const response = yield* sendRequest(
        {
          name: serverName,
          transport: server.transport,
          endpoint: server.endpoint,
          command: server.command,
        },
        {
          jsonrpc: "2.0",
          id: reqId,
          method: "tools/call",
          params: { name: toolName, arguments: args },
        },
      );

      if (response.error) {
        return yield* Effect.fail(
          new ToolExecutionError({
            message: `MCP tool "${toolName}" failed: ${response.error.message}`,
            toolName,
            input: args,
          }),
        );
      }

      return response.result;
    });

  const disconnect = (
    serverName: string,
  ): Effect.Effect<void, MCPConnectionError> =>
    Ref.update(serversRef, (servers) => {
      const newServers = new Map(servers);
      const server = newServers.get(serverName);
      if (server) {
        newServers.set(serverName, { ...server, status: "disconnected" });
      }
      return newServers;
    });

  const listServers = (): Effect.Effect<readonly MCPServer[], never> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      return [...servers.values()];
    });

  return { connect, callTool, disconnect, listServers };
});
