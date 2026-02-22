import { Effect, Ref } from "effect";

import type { MCPServer, MCPRequest, MCPResponse } from "../types.js";
import { MCPConnectionError, ToolExecutionError } from "../errors.js";

// ─── Active Transport State ───

interface StdioTransport {
  subprocess: ReturnType<typeof Bun.spawn>;
  pendingRequests: Map<
    string | number,
    {
      resolve: (response: MCPResponse) => void;
      reject: (err: Error) => void;
    }
  >;
  readerStopped: boolean;
}

// Module-level map: serverName -> StdioTransport
const activeTransports = new Map<string, StdioTransport>();

// ─── Background stdout reader ───

const startStdioReader = (
  serverName: string,
  transport: StdioTransport,
): void => {
  const { subprocess } = transport;

  void (async () => {
    // Cast to AsyncIterable — Bun.spawn({stdout:"pipe"}) returns ReadableStream
    const stdout = subprocess.stdout as AsyncIterable<Uint8Array> | null;
    if (!stdout) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for await (const chunk of stdout) {
        if (transport.readerStopped) break;

        buffer += decoder.decode(chunk as Uint8Array, { stream: true });

        // Split on newlines — process each complete line
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: MCPResponse;
          try {
            parsed = JSON.parse(trimmed) as MCPResponse;
          } catch {
            // Not valid JSON (e.g., server log lines) — skip
            continue;
          }

          const pending = transport.pendingRequests.get(parsed.id);
          if (pending) {
            transport.pendingRequests.delete(parsed.id);
            pending.resolve(parsed);
          }
          // Unsolicited notifications (no matching pending) are silently dropped
        }
      }
    } catch (err) {
      // Reader died — reject all pending requests
      transport.readerStopped = true;
      for (const [id, pending] of transport.pendingRequests) {
        transport.pendingRequests.delete(id);
        pending.reject(
          err instanceof Error
            ? err
            : new Error(
                `MCP stdio reader error for "${serverName}": ${String(err)}`,
              ),
        );
      }
    }
  })();
};

// ─── Transport Creation ───

const createTransport = (
  config: Pick<
    MCPServer,
    "name" | "transport" | "endpoint" | "command" | "args"
  >,
): Effect.Effect<void, unknown> => {
  if (config.transport === "stdio") {
    return Effect.tryPromise(async () => {
      const command = config.command;
      if (!command) {
        throw new Error(
          `MCP server "${config.name}" has transport "stdio" but no command specified`,
        );
      }

      const subprocess = Bun.spawn([command, ...(config.args ?? [])], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      const transport: StdioTransport = {
        subprocess,
        pendingRequests: new Map(),
        readerStopped: false,
      };

      activeTransports.set(config.name, transport);
      startStdioReader(config.name, transport);
    });
  }

  // SSE transport — TODO: implement HTTP event stream
  if (config.transport === "sse") {
    return Effect.void;
  }

  // WebSocket transport — TODO: implement WebSocket
  if (config.transport === "websocket") {
    return Effect.void;
  }

  return Effect.void;
};

// ─── JSON-RPC Request Sender ───

const sendRequest = (
  config: Pick<MCPServer, "name" | "transport" | "endpoint" | "command">,
  request: MCPRequest,
): Effect.Effect<MCPResponse, MCPConnectionError> => {
  if (config.transport === "stdio") {
    return Effect.tryPromise({
      try: () => {
        const transport = activeTransports.get(config.name);
        if (!transport) {
          return Promise.reject(
            new Error(
              `No active stdio transport for MCP server "${config.name}" — was createTransport called?`,
            ),
          );
        }

        return new Promise<MCPResponse>((resolve, reject) => {
          // Register before writing to avoid a race where the server
          // responds faster than we register the handler
          transport.pendingRequests.set(request.id, { resolve, reject });

          const line = JSON.stringify(request) + "\n";
          const encoded = new TextEncoder().encode(line);
          const stdin = transport.subprocess.stdin;

          if (!stdin) {
            transport.pendingRequests.delete(request.id);
            reject(
              new Error(
                `Subprocess stdin is not writable for MCP server "${config.name}"`,
              ),
            );
            return;
          }

          // Bun.FileSink.write() is synchronous — returns bytes written, not a Promise
          try {
            (stdin as unknown as { write(b: Uint8Array): number }).write(
              encoded,
            );
            // flush() may return void or Promise<void>
            const flushed = (
              stdin as unknown as { flush?(): void | Promise<void> }
            ).flush?.();
            if (flushed instanceof Promise) {
              flushed.catch((err: unknown) => {
                transport.pendingRequests.delete(request.id);
                reject(
                  err instanceof Error
                    ? err
                    : new Error(
                        `Flush failed for MCP server "${config.name}": ${String(err)}`,
                      ),
                );
              });
            }
          } catch (err) {
            transport.pendingRequests.delete(request.id);
            reject(
              err instanceof Error
                ? err
                : new Error(
                    `Failed to write to MCP server "${config.name}" stdin: ${String(err)}`,
                  ),
            );
          }
        });
      },
      catch: (e) =>
        new MCPConnectionError({
          message:
            e instanceof Error
              ? e.message
              : `Failed to send request to MCP server "${config.name}"`,
          serverName: config.name,
          transport: config.transport,
          cause: e,
        }),
    });
  }

  // SSE / WebSocket stubs — return empty success
  return Effect.succeed({
    jsonrpc: "2.0" as const,
    id: request.id,
    result: {},
  });
};

// ─── MCP Client ───

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

      // MCP initialize handshake
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

      // Discover available tools
      const reqId2 = yield* nextRequestId;
      const toolsResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: reqId2,
        method: "tools/list",
      });

      // Parse full tool schemas from MCP tools/list response
      const rawTools = Array.isArray(
        (toolsResponse.result as Record<string, unknown>)?.tools,
      )
        ? ((toolsResponse.result as Record<string, unknown>).tools as Array<
            Record<string, unknown>
          >)
        : Array.isArray(toolsResponse.result)
          ? (toolsResponse.result as Array<Record<string, unknown>>)
          : [];

      const toolNames = rawTools.map((t) => t.name as string);
      const toolSchemas = rawTools.map((t) => ({
        name: t.name as string,
        description: t.description as string | undefined,
        inputSchema: t.inputSchema as
          | Record<string, unknown>
          | undefined,
      }));

      const server: MCPServer = {
        name: config.name,
        version:
          (initResponse.result as Record<string, unknown>)?.serverInfo != null
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
        toolSchemas,
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
    Effect.gen(function* () {
      const transport = activeTransports.get(serverName);
      if (transport) {
        transport.readerStopped = true;

        // Reject any in-flight requests before killing the process
        for (const [id, pending] of transport.pendingRequests) {
          transport.pendingRequests.delete(id);
          pending.reject(
            new Error(
              `MCP server "${serverName}" disconnected with pending request id=${String(id)}`,
            ),
          );
        }

        try {
          transport.subprocess.kill();
        } catch {
          // Process may already be gone
        }

        activeTransports.delete(serverName);
      }

      yield* Ref.update(serversRef, (servers) => {
        const newServers = new Map(servers);
        const server = newServers.get(serverName);
        if (server) {
          newServers.set(serverName, { ...server, status: "disconnected" });
        }
        return newServers;
      });
    });

  const listServers = (): Effect.Effect<readonly MCPServer[], never> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      return [...servers.values()];
    });

  return { connect, callTool, disconnect, listServers };
});
